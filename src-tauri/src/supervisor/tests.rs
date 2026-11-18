use super::*;
use std::collections::HashSet;
use std::fs;
use std::time::Duration;

#[test]
fn streams_both_pipes_in_a_git_worktree() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init"]);
    fs::write(repo.join("fixture.txt"), "from the worktree").unwrap();
    git(&repo, &["add", "fixture.txt"]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "seed",
        ],
    );

    let worktree = Worktree::add(&repo, &temp.path().join("test worktree"), "HEAD").unwrap();
    let mut command = Command::new("node");
    command.args(["-e", "console.log(require('node:fs').readFileSync('fixture.txt', 'utf8')); console.error('from stderr');"]);
    let (process, output) = worktree.spawn(command).unwrap();
    assert!(process.wait().unwrap().success());
    assert_eq!(
        output.into_iter().collect::<HashSet<_>>(),
        HashSet::from([
            OutputLine {
                stream: Stream::Stdout,
                text: "from the worktree".into()
            },
            OutputLine {
                stream: Stream::Stderr,
                text: "from stderr".into()
            },
        ])
    );
    worktree.remove().unwrap();
    assert!(!temp.path().join("test worktree").exists());
}

#[test]
fn cancel_reaps_parent_and_grandchild_and_closes_the_output_stream() {
    let temp = tempfile::tempdir().unwrap();
    let mut command = Command::new("node");
    command.args([
        "-e",
        r#"
        require('node:child_process').spawn(process.execPath, [
            '-e', "console.log('grandchild active'); setInterval(() => {}, 1000);"
        ], { stdio: 'inherit' });
        setInterval(() => {}, 1000);
    "#,
    ]);
    let (process, output) = Process::spawn(temp.path(), command).unwrap();
    assert_eq!(
        output.recv_timeout(Duration::from_secs(20)).unwrap().text,
        "grandchild active"
    );
    process.cancel();
    assert!(matches!(
        output.recv_timeout(Duration::from_secs(10)),
        Err(mpsc::RecvTimeoutError::Disconnected)
    ));
    assert!(!process.wait().unwrap().success());
}

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
