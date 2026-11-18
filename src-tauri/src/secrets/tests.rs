use super::*;
use std::collections::HashMap;
use std::sync::Mutex;

/// A stand-in for the system keychain: same trait, values held in memory. It records every name it was asked for.
#[derive(Default)]
struct MemoryStore {
    values: Mutex<HashMap<String, String>>,
    reads: Mutex<Vec<String>>,
    fail_reads: bool,
}

impl SecretStore for MemoryStore {
    fn get(&self, name: &str) -> Result<Option<String>, &'static str> {
        self.reads.lock().unwrap().push(name.to_string());
        if self.fail_reads {
            return Err("Could not read the system keychain");
        }
        Ok(self.values.lock().unwrap().get(name).cloned())
    }

    fn set(&self, name: &str, value: &str) -> Result<(), &'static str> {
        self.values
            .lock()
            .unwrap()
            .insert(name.to_string(), value.to_string());
        Ok(())
    }
}

#[test]
fn stores_and_reads_only_the_known_secret_names() {
    let store = MemoryStore::default();
    for name in SECRET_NAMES {
        assert_eq!(fetch(&store, name), Ok(None));
        save(&store, name, "value").unwrap();
        assert_eq!(fetch(&store, name), Ok(Some("value".to_string())));
    }
    for name in [
        "PATH",
        "NODE_OPTIONS",
        "anthropic_api_key",
        "",
        "ANTHROPIC_API_KEY ",
    ] {
        assert_eq!(save(&store, name, "value"), Err("Unknown secret name"));
        assert_eq!(fetch(&store, name), Err("Unknown secret name"));
    }
    assert!(!store.values.lock().unwrap().contains_key("PATH"));
}

#[test]
fn refuses_unusable_values_without_echoing_them() {
    let store = MemoryStore::default();
    let too_long = "k".repeat(MAX_SECRET_CHARS + 1);
    for value in ["", "   ", "sk-ant\0secret", too_long.as_str()] {
        let error = save(&store, "ANTHROPIC_API_KEY", value).unwrap_err();
        assert!(!error.contains("sk-ant"), "error leaked the value: {error}");
    }
    assert!(store.values.lock().unwrap().is_empty());
    save(&store, "ANTHROPIC_API_KEY", &"k".repeat(MAX_SECRET_CHARS)).unwrap();
}

#[test]
fn launch_environment_copies_stored_secrets_and_lets_the_parent_environment_win() {
    let store = MemoryStore::default();
    save(&store, "ANTHROPIC_API_KEY", "from-keychain").unwrap();
    save(&store, "AWS_BEARER_TOKEN_BEDROCK", "bedrock-token").unwrap();

    let launched = launch_environment(&store, |_| false);
    assert_eq!(
        launched,
        vec![
            ("ANTHROPIC_API_KEY", "from-keychain".to_string()),
            ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-token".to_string()),
        ]
    );

    store.reads.lock().unwrap().clear();
    let launched = launch_environment(&store, |name| name == "ANTHROPIC_API_KEY");
    assert_eq!(
        launched,
        vec![("AWS_BEARER_TOKEN_BEDROCK", "bedrock-token".to_string())]
    );
    assert!(
        !store
            .reads
            .lock()
            .unwrap()
            .contains(&"ANTHROPIC_API_KEY".to_string())
    );
}

#[test]
fn launch_environment_skips_secrets_that_cannot_be_read() {
    let store = MemoryStore {
        fail_reads: true,
        ..MemoryStore::default()
    };
    assert!(launch_environment(&store, |_| false).is_empty());
}

#[test]
fn the_secret_names_match_the_ones_the_sidecar_documents() {
    let docs = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/SIDECAR.md"),
    )
    .unwrap();
    for name in SECRET_NAMES {
        assert!(
            docs.contains(&format!("`{name}`")),
            "{name} is not documented"
        );
    }
}
