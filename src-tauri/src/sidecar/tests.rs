use super::*;
use serde_json::json;

#[test]
fn forwards_events_and_restarts_exited_sidecar() {
    let script = r#"
        require('node:readline').createInterface({input: process.stdin}).on('line', line => {
            const { id, method } = JSON.parse(line);
            if (method === 'crash') process.exit(2);
            console.log(JSON.stringify({ jsonrpc: '2.0', id, result: process.pid }));
            console.log(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { pid: process.pid } }));
        });
    "#;
    let build_command = move || {
        let mut command = Command::new("node");
        command.args(["-e", script]);
        command
    };
    let (event_tx, event_rx) = mpsc::channel();
    let sidecar = Sidecar::start(
        build_command,
        move |event| {
        event_tx.send(event).unwrap();
    },
        || {},
    )
    .unwrap();

    let first = available(&sidecar);
    assert_eq!(
        event_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        json!({ "pid": first })
    );
    assert_eq!(sidecar.call("crash".into(), None).unwrap_err().code, -32000);

    let restarted = available(&sidecar);
    assert_ne!(first, restarted);
    assert_eq!(
        event_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        json!({ "pid": restarted })
    );
    sidecar.shutdown();
    assert!(sidecar.call("health".into(), None).is_err());
}

fn available(sidecar: &Sidecar) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match sidecar.call("health".into(), None) {
            Ok(value) => return value,
            Err(error) if Instant::now() >= deadline => panic!("Sidecar did not start: {error:?}"),
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

#[test]
fn restart_replaces_the_process_and_fails_calls_in_flight() {
    let script = r#"
        require('node:readline').createInterface({input: process.stdin}).on('line', line => {
            const { id, method } = JSON.parse(line);
            if (method === 'hang') return;
            console.log(JSON.stringify({ jsonrpc: '2.0', id, result: process.pid }));
        });
    "#;
    let build_command = move || {
        let mut command = Command::new("node");
        command.args(["-e", script]);
        command
    };
    let starts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = std::sync::Arc::clone(&starts);
    let sidecar = std::sync::Arc::new(
        Sidecar::start(build_command, |_| {}, move || {
            counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
        .unwrap(),
    );
    let first = available(&sidecar);

    let waiting = {
        let sidecar = std::sync::Arc::clone(&sidecar);
        thread::spawn(move || sidecar.call("hang".into(), None))
    };
    thread::sleep(Duration::from_millis(300));
    sidecar.restart();
    assert_eq!(waiting.join().unwrap().unwrap_err().code, -32000);

    let second = available(&sidecar);
    assert_ne!(first, second);
    // Every process the supervisor starts is announced, so the UI can subscribe again.
    assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 2);
    sidecar.shutdown();
}

/// The contract between this Rust bridge and the real TypeScript sidecar (the same frames the `rpc` command
/// forwards): a seeded SQLite event log, then health, request, the first-run methods, errors and a subscribe
/// whose replayed events come out of `emit` with the notification shape the UI relies on.
#[test]
fn speaks_the_json_rpc_contract_with_the_real_sidecar() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let data = tempfile::tempdir().unwrap();
    let database = data.path().join("events.sqlite");
    let seeded = Command::new("node")
        .current_dir(&root)
        .args(["--import", "tsx", "--input-type=module", "-e"])
        .arg(
            "const { SqliteEventLog } = await import('./apps/api/src/store/sqlite-event-log.ts');
             const log = await SqliteEventLog.open(process.argv[1]);
             await log.emit({ mission_id: 'demo', type: 'mission.created' });
             await log.emit({ mission_id: 'demo', type: 'mission.finished' });
             await log.close();",
        )
        .arg(&database)
        .status()
        .unwrap();
    assert!(seeded.success());

    let data_path = data.path().to_path_buf();
    let build_command = move || {
        let mut command = Command::new("node");
        command
            .current_dir(&root)
            .args(["--import", "tsx", "apps/sidecar/src/main.ts"])
            .env("BULLETIN_DATA_DIR", &data_path)
            .env("BULLETIN_SCRATCH_DIR", &data_path)
            .env("BULLETIN_EVENT_STORE", "sqlite")
            .env("BULLETIN_RUNNER", "claude")
            .env("BULLETIN_PROVIDER", "");
        command
    };
    let (event_tx, event_rx) = mpsc::channel();
    let sidecar = Sidecar::start(
        build_command,
        move |event| {
        event_tx.send(event).unwrap();
    },
        || {},
    )
    .unwrap();

    assert_eq!(
        available(&sidecar),
        json!({ "status": "ok", "service": "api" })
    );

    let missions = sidecar
        .call(
            "request".into(),
            Some(json!({ "method": "GET", "path": "/missions?status=finished" })),
        )
        .unwrap();
    assert_eq!(missions["status"], 200);
    assert_eq!(missions["body"]["missions"][0]["id"], "demo");

    // The first-run methods answer with exactly the documented keys.
    let env = sidecar.call("env.check".into(), None).unwrap();
    let keys = |value: &Value| {
        let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    };
    assert_eq!(keys(&env), ["claude", "git", "provider"]);
    assert_eq!(keys(&env["git"]), ["found", "version"]);
    assert_eq!(keys(&env["claude"]), ["found", "logged_in"]);
    assert_eq!(keys(&env["provider"]), ["env", "id", "ready"]);
    assert_eq!(env["provider"]["id"], "claude-code");
    let settings = sidecar
        .call("settings.get".into(), Some(json!({})))
        .unwrap();
    assert_eq!(settings, json!({ "settings": {} }));
    let secret = sidecar
        .call(
            "secret.has".into(),
            Some(json!({ "name": "BULLETIN_GITHUB_TOKEN" })),
        )
        .unwrap();
    assert_eq!(secret["name"], "BULLETIN_GITHUB_TOKEN");
    assert!(secret["present"].is_boolean());

    // Protocol errors arrive as code and message.
    let unknown = sidecar.call("no.such.method".into(), None).unwrap_err();
    assert_eq!(
        (unknown.code, unknown.message.as_str()),
        (-32601, "Method not found")
    );
    let bad_path = sidecar
        .call("repo.inspect".into(), Some(json!({ "path": "relative" })))
        .unwrap_err();
    assert_eq!(bad_path.code, -32602);
    let bad_secret = sidecar
        .call(
            "secret.set".into(),
            Some(json!({ "name": "PATH", "value": "x" })),
        )
        .unwrap_err();
    assert_eq!(bad_secret.code, -32602);
    let missing = sidecar
        .call("subscribe".into(), Some(json!({ "mission_id": "missing" })))
        .unwrap_err();
    assert_eq!(missing.code, -32004);

    // A subscription replays committed events, in order, as the notification's params.
    let subscribed = sidecar
        .call(
            "subscribe".into(),
            Some(json!({ "mission_id": "demo", "after": 0 })),
        )
        .unwrap();
    assert_eq!(subscribed, json!({ "subscription_id": 1 }));
    for (id, kind) in [(1, "mission.created"), (2, "mission.finished")] {
        let params = event_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(params["subscription_id"], 1);
        assert_eq!(params["event"]["id"], id);
        assert_eq!(params["event"]["type"], kind);
        assert_eq!(params["event"]["mission_id"], "demo");
        assert!(params["event"]["ts"].is_string());
    }
    sidecar.shutdown();
}
