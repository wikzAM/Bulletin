#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secrets;
mod sidecar;

use secrets::{OsSecretStore, SecretStore};
use serde_json::Value;
use sidecar::{RpcError, Sidecar};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

struct Desktop {
    sidecar: Arc<Sidecar>,
    secrets: Arc<dyn SecretStore>,
}

#[tauri::command]
async fn rpc(
    state: State<'_, Desktop>,
    method: String,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    let sidecar = Arc::clone(&state.sidecar);
    tauri::async_runtime::spawn_blocking(move || sidecar.call(method, params))
        .await
        .map_err(|_| RpcError::unavailable())?
}

/// Stores a secret in the system keychain. The sidecar only sees secrets in its environment at launch, so a
/// changed value restarts it (calls in flight fail with -32000 and subscriptions end; docs/SIDECAR.md, "Secrets").
#[tauri::command]
fn secret_set(state: State<'_, Desktop>, name: String, value: String) -> Result<(), &'static str> {
    let unchanged = secrets::fetch(state.secrets.as_ref(), &name)
        .ok()
        .flatten()
        .as_deref()
        == Some(value.as_str());
    secrets::save(state.secrets.as_ref(), &name, &value)?;
    if !unchanged {
        state.sidecar.restart();
    }
    Ok(())
}

#[tauri::command]
fn secret_get(state: State<'_, Desktop>, name: String) -> Result<Option<String>, &'static str> {
    secrets::fetch(state.secrets.as_ref(), &name)
}

#[tauri::command]
fn secret_has(state: State<'_, Desktop>, name: String) -> Result<bool, &'static str> {
    secrets::fetch(state.secrets.as_ref(), &name).map(|value| value.is_some())
}

fn sidecar_command(resource_dir: &Path, bundled: &Path, secrets: &dyn SecretStore) -> Command {
    let override_path = env::var_os("BULLETIN_SIDECAR_PATH").filter(|path| !path.is_empty());
    let packaged = override_path.is_some() || !cfg!(debug_assertions);
    let mut command = if let Some(path) = override_path {
        Command::new(path)
    } else if cfg!(debug_assertions) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root");
        if root.join("apps/sidecar/package.json").is_file() {
            let mut command = Command::new(if cfg!(windows) { "pnpm.cmd" } else { "pnpm" });
            command.current_dir(root).args([
                "--filter",
                "@bulletin/sidecar",
                "exec",
                "tsx",
                "src/main.ts",
            ]);
            command
        } else {
            let mut command = Command::new("node");
            command
                .current_dir(root)
                .args(["--import", "tsx", "apps/sidecar/src/main.ts"]);
            command
        }
    } else {
        Command::new(bundled)
    };
    if packaged
        && env::var_os("BULLETIN_RESOURCE_DIR").is_none()
        && resource_dir.join("config/models.json").is_file()
    {
        command.env("BULLETIN_RESOURCE_DIR", resource_dir);
    }
    // Stored secrets reach the sidecar only as environment variables, and only when Bulletin's own environment
    // does not already set them.
    let provided = |name: &str| env::var_os(name).is_some_and(|value| !value.is_empty());
    command.envs(secrets::launch_environment(secrets, provided));
    command
}

fn main() {
    let builder = tauri::Builder::default();
    // Updates are opt-in: the plugin exists only in a build made with `--features updater`.
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let bundled: PathBuf = env::current_exe()?
                .with_file_name(format!("bulletin-sidecar{}", env::consts::EXE_SUFFIX));
            let secrets: Arc<dyn SecretStore> = Arc::new(OsSecretStore);
            let launch_secrets = Arc::clone(&secrets);
            let handle = app.handle().clone();
            let sidecar = Sidecar::start(
                move || sidecar_command(&resource_dir, &bundled, launch_secrets.as_ref()),
                move |event| {
                    let _ = handle.emit("bulletin://event", event);
                },
            )?;
            app.manage(Desktop {
                sidecar: Arc::new(sidecar),
                secrets,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc, secret_set, secret_get, secret_has
        ])
        .build(tauri::generate_context!())
        .expect("could not initialize Bulletin desktop");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit)
            && let Some(state) = handle.try_state::<Desktop>()
        {
            state.sidecar.shutdown();
        }
    });
}
