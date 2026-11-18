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
    let sidecar = Sidecar::start(build_command, move |event| {
        event_tx.send(event).unwrap();
    })
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
