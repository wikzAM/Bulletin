use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(test)]
mod tests;

pub struct Worktree {
    repo: PathBuf,
    path: PathBuf,
}

impl Worktree {
    pub fn add(repo: &Path, path: &Path, revision: &str) -> io::Result<Self> {
        let repo = std::path::absolute(repo)?;
        let path = std::path::absolute(path)?;
        run_git(
            git_command(&repo)
                .args(["worktree", "add", "--detach", "--"])
                .arg(&path)
                .arg(revision),
        )?;
        Ok(Self { repo, path })
    }

    pub fn spawn(&self, command: Command) -> io::Result<(Process, mpsc::Receiver<OutputLine>)> {
        Process::spawn(&self.path, command)
    }

    pub fn remove(&self) -> io::Result<()> {
        run_git(
            git_command(&self.repo)
                .args(["worktree", "remove", "--"])
                .arg(&self.path),
        )
    }
}

fn git_command(repo: &Path) -> Command {
    let mut command = Command::new("git");
    command.current_dir(repo).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn run_git(command: &mut Command) -> io::Result<()> {
    let result = command.output()?;
    if result.status.success() {
        Ok(())
    } else {
        Err(io::Error::other(
            String::from_utf8_lossy(&result.stderr).trim().to_owned(),
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Debug, Eq, Hash, PartialEq, serde::Serialize)]
pub struct OutputLine {
    pub stream: Stream,
    pub text: String,
}

pub struct Process {
    cancel: mpsc::Sender<()>,
    completion: Option<JoinHandle<io::Result<ExitStatus>>>,
}

impl Process {
    pub fn spawn(
        directory: &Path,
        mut command: Command,
    ) -> io::Result<(Self, mpsc::Receiver<OutputLine>)> {
        command
            .current_dir(directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = ManagedChild::spawn(&mut command)?;
        let stdout = child.child_mut().stdout.take().expect("stdout is piped");
        let stderr = child.child_mut().stderr.take().expect("stderr is piped");
        let (output, lines) = mpsc::channel();
        let stdout = stream_lines(Stream::Stdout, stdout, output.clone())?;
        let stderr = stream_lines(Stream::Stderr, stderr, output)?;

        let (cancel, requests) = mpsc::channel();
        let completion = thread::Builder::new()
            .name("bulletin-worktree-process".into())
            .spawn(move || {
                let status = loop {
                    match child.child_mut().try_wait() {
                        Ok(None) => {}
                        result => break result,
                    }
                    match requests.recv_timeout(Duration::from_millis(50)) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break Ok(None),
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                };
                // Even if the command exited normally, silent descendants may still own its pipes.
                child.terminate();
                let status =
                    status.and_then(|status| status.map_or_else(|| child.child_mut().wait(), Ok));
                let _ = stdout.join();
                let _ = stderr.join();
                status
            })?;
        Ok((
            Self {
                cancel,
                completion: Some(completion),
            },
            lines,
        ))
    }

    pub fn cancel(&self) {
        let _ = self.cancel.send(());
    }

    pub fn wait(mut self) -> io::Result<ExitStatus> {
        self.completion
            .take()
            .expect("process owns completion")
            .join()
            .map_err(|_| io::Error::other("process supervisor stopped unexpectedly"))?
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        if let Some(completion) = self.completion.take() {
            self.cancel();
            let _ = completion.join();
        }
    }
}

fn stream_lines(
    stream: Stream,
    pipe: impl Read + Send + 'static,
    output: mpsc::Sender<OutputLine>,
) -> io::Result<JoinHandle<()>> {
    thread::Builder::new()
        .name(format!("bulletin-worktree-{stream:?}"))
        .spawn(move || {
            let mut reader = BufReader::new(pipe);
            let mut bytes = Vec::new();
            while let Ok(1..) = reader.read_until(b'\n', &mut bytes) {
                if bytes.last() == Some(&b'\n') {
                    bytes.pop();
                    if bytes.last() == Some(&b'\r') {
                        bytes.pop();
                    }
                }
                let text = String::from_utf8_lossy(&bytes).into_owned();
                // Keep draining the pipe after the listener closes so the child can exit.
                let _ = output.send(OutputLine { stream, text });
                bytes.clear();
            }
        })
}

/// Owns the child process and its descendants, including on early returns.
pub struct ManagedChild {
    child: Child,
    tree: Option<platform::Tree>,
}

impl ManagedChild {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        let (child, tree) = platform::spawn(command)?;
        Ok(Self {
            child,
            tree: Some(tree),
        })
    }

    pub fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }

    pub fn terminate(&mut self) {
        if let Some(tree) = self.tree.take() {
            tree.terminate();
            let _ = self.child.kill();
        }
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        self.terminate();
        let _ = self.child.wait();
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::{ChildExt, CommandExt};
    use std::ptr::null;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED, ResumeThread};

    pub(super) struct Tree(OwnedHandle);

    impl Tree {
        pub(super) fn terminate(self) {
            // A cancelled command reports failure to the caller on Windows as well.
            unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
        }
    }

    pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, Tree)> {
        // The job is unnamed and its handle is private to this supervisor.
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }

        let mut child = command
            .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED)
            .spawn()?;
        // Contain the child before any of its code can start a descendant.
        if unsafe { AssignProcessToJobObject(job.as_raw_handle(), child.as_raw_handle()) } == 0
            || unsafe { ResumeThread(child.main_thread_handle().as_raw_handle()) } == u32::MAX
        {
            let error = io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok((child, Tree(job)))
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::os::unix::process::CommandExt;

    pub(super) struct Tree(libc::pid_t);

    impl Tree {
        pub(super) fn terminate(self) {
            // The process spawned below leads a group distinct from the app's group.
            unsafe { libc::killpg(self.0, libc::SIGKILL) };
        }
    }

    pub(super) fn spawn(command: &mut Command) -> io::Result<(Child, Tree)> {
        let child = command.process_group(0).spawn()?;
        let tree = Tree(child.id() as libc::pid_t);
        Ok((child, tree))
    }
}
