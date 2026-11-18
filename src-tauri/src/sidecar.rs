use bulletin_desktop::supervisor::ManagedChild;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests;

const RESTART_DELAY: Duration = Duration::from_millis(500);
const CHECK_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Serialize)]
pub(crate) struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    pub(crate) fn unavailable() -> Self {
        Self {
            code: -32000,
            message: "Sidecar unavailable".into(),
        }
    }
}

type Response = Result<Value, RpcError>;
type ResponseSender = mpsc::Sender<Response>;

enum Message {
    Request {
        method: String,
        params: Option<Value>,
        response: ResponseSender,
    },
    Frame {
        generation: u64,
        line: String,
    },
    Disconnected(u64),
    Restart,
    Shutdown,
}

pub(crate) struct Sidecar {
    messages: mpsc::Sender<Message>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

impl Sidecar {
    pub(crate) fn start(
        command: impl Fn() -> Command + Send + 'static,
        emit: impl Fn(Value) + Send + 'static,
    ) -> io::Result<Self> {
        let (messages, receiver) = mpsc::channel();
        let send = messages.clone();
        let supervisor = thread::Builder::new()
            .name("bulletin-sidecar".into())
            .spawn(move || supervise(command, emit, receiver, send))?;
        Ok(Self {
            messages,
            supervisor: Mutex::new(Some(supervisor)),
        })
    }

    pub(crate) fn call(&self, method: String, params: Option<Value>) -> Response {
        let (response, result) = mpsc::channel();
        self.messages
            .send(Message::Request {
                method,
                params,
                response,
            })
            .map_err(|_| RpcError::unavailable())?;
        result
            .recv()
            .unwrap_or_else(|_| Err(RpcError::unavailable()))
    }

    /// Stops the running sidecar and starts a new one right away, which re-reads the launch environment.
    /// Calls in flight fail with the "unavailable" error and subscriptions are gone.
    pub(crate) fn restart(&self) {
        let _ = self.messages.send(Message::Restart);
    }

    pub(crate) fn shutdown(&self) {
        let mut supervisor = self.supervisor.lock().unwrap();
        if let Some(handle) = supervisor.take() {
            let _ = self.messages.send(Message::Shutdown);
            let _ = handle.join();
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Running {
    child: ManagedChild,
    generation: u64,
    input: Option<mpsc::Sender<String>>,
    pending: HashMap<u64, ResponseSender>,
}

impl Running {
    fn start(
        mut command: Command,
        generation: u64,
        messages: &mpsc::Sender<Message>,
    ) -> io::Result<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = ManagedChild::spawn(&mut command)?;
        let mut stdin = child
            .child_mut()
            .stdin
            .take()
            .expect("sidecar stdin is piped");
        let stdout = child
            .child_mut()
            .stdout
            .take()
            .expect("sidecar stdout is piped");
        let (input, queue) = mpsc::channel();
        let running = Self {
            child,
            generation,
            input: Some(input),
            pending: HashMap::new(),
        };

        let writer = messages.clone();
        thread::Builder::new()
            .name("bulletin-sidecar-stdin".into())
            .spawn(move || {
                for line in queue {
                    if writeln!(stdin, "{line}").is_err() {
                        let _ = writer.send(Message::Disconnected(generation));
                        break;
                    }
                }
            })?;
        let reader = messages.clone();
        thread::Builder::new()
            .name("bulletin-sidecar-stdout".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if reader.send(Message::Frame { generation, line }).is_err() {
                        return;
                    }
                }
                let _ = reader.send(Message::Disconnected(generation));
            })?;
        Ok(running)
    }

    fn request(
        &mut self,
        id: u64,
        method: String,
        params: Option<Value>,
        response: ResponseSender,
    ) {
        let mut frame = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if let Some(params) = params {
            frame["params"] = params;
        }
        if self
            .input
            .as_ref()
            .is_some_and(|input| input.send(frame.to_string()).is_ok())
        {
            self.pending.insert(id, response);
        } else {
            let _ = response.send(Err(RpcError::unavailable()));
        }
    }

    fn receive(&mut self, line: &str, emit: &impl Fn(Value)) {
        let Ok(mut frame) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if frame["jsonrpc"] != "2.0" {
            return;
        }
        if frame["method"] == "event" && frame["params"].is_object() {
            emit(frame["params"].take());
        } else if let Some(id) = frame["id"].as_u64() {
            let response = if let Some(result) = frame.get_mut("result") {
                Ok(result.take())
            } else {
                let error = &frame["error"];
                Err(RpcError {
                    code: error["code"].as_i64().unwrap_or(-32603),
                    message: error["message"]
                        .as_str()
                        .unwrap_or("Invalid sidecar response")
                        .into(),
                })
            };
            if let Some(pending) = self.pending.remove(&id) {
                let _ = pending.send(response);
            }
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        for (_, response) in self.pending.drain() {
            let _ = response.send(Err(RpcError::unavailable()));
        }
        self.input.take();
    }
}

fn supervise(
    command: impl Fn() -> Command,
    emit: impl Fn(Value),
    receiver: mpsc::Receiver<Message>,
    messages: mpsc::Sender<Message>,
) {
    let mut running = None;
    let mut generation = 0;
    let mut next_id = 1;
    let mut retry_at = Instant::now();
    loop {
        if running.is_none() && Instant::now() >= retry_at {
            generation += 1;
            match Running::start(command(), generation, &messages) {
                Ok(child) => running = Some(child),
                Err(error) => {
                    eprintln!("Bulletin sidecar launch failed ({:?})", error.kind());
                    retry_at = Instant::now() + RESTART_DELAY;
                }
            }
        }

        match receiver.recv_timeout(CHECK_INTERVAL) {
            Ok(Message::Request {
                method,
                params,
                response,
            }) => {
                if let Some(child) = &mut running {
                    child.request(next_id, method, params, response);
                    next_id += 1;
                } else {
                    let _ = response.send(Err(RpcError::unavailable()));
                }
            }
            Ok(Message::Frame { generation, line }) => {
                if let Some(child) = &mut running
                    && child.generation == generation
                {
                    child.receive(&line, &emit);
                }
            }
            Ok(Message::Disconnected(generation)) => {
                if running
                    .as_ref()
                    .is_some_and(|child| child.generation == generation)
                {
                    running = None;
                    retry_at = Instant::now() + RESTART_DELAY;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(child) = &mut running
                    && matches!(child.child.child_mut().try_wait(), Ok(Some(_)) | Err(_))
                {
                    running = None;
                    retry_at = Instant::now() + RESTART_DELAY;
                }
            }
            Ok(Message::Restart) => {
                running = None;
                retry_at = Instant::now();
            }
            Ok(Message::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}
