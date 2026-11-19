//! "Choose folder": a native folder dialog without a new dependency. On Windows a hidden PowerShell shows the
//! standard folder browser and prints the picked path; elsewhere there is no picker and the person types the path.

use std::path::Path;

/// What the dialog printed, as a folder path to hand to the UI: the first line, trimmed, only if it is an absolute
/// path without control characters. Cancelling prints nothing, which gives `None`.
pub(crate) fn parse_picked(output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    let line = text.trim_start_matches('\u{feff}').lines().next()?.trim();
    if line.is_empty() || line.chars().any(char::is_control) || !Path::new(line).is_absolute() {
        return None;
    }
    Some(line.to_string())
}

#[cfg(windows)]
const SCRIPT: &str = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
Add-Type -AssemblyName System.Windows.Forms; \
$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; \
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
$dialog.Description = 'Choose the repository folder'; $dialog.ShowNewFolderButton = $false; \
if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }";

/// Shows the dialog and waits for it. `None` when cancelled or when there is no picker on this system.
#[cfg(windows)]
pub(crate) fn pick() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", SCRIPT])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    parse_picked(&output.stdout)
}

#[cfg(not(windows))]
pub(crate) fn pick() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::parse_picked;

    #[test]
    fn takes_the_first_absolute_path_the_dialog_printed() {
        let path = if cfg!(windows) { "C:\\work\\demo" } else { "/work/demo" };
        assert_eq!(parse_picked(format!("{path}\r\n").as_bytes()), Some(path.to_string()));
        assert_eq!(parse_picked(format!("\u{feff}{path}").as_bytes()), Some(path.to_string()));
    }

    #[test]
    fn cancelling_or_odd_output_gives_nothing() {
        assert_eq!(parse_picked(b""), None);
        assert_eq!(parse_picked(b"   \r\n"), None);
        assert_eq!(parse_picked(b"relative\\folder"), None);
        assert_eq!(parse_picked(b"not a path at all"), None);
        assert_eq!(parse_picked(b"\x1b[31mC:\\x"), None);
    }
}
