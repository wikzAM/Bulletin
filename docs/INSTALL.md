# Installing Bulletin on Windows

This guide is for the person who will install the Bulletin desktop app and run a first project. It covers
getting the installer, the Windows warning you will see, the first-run screen, a first project, where Bulletin keeps
things, how to remove it, and what to try when something does not start.

Bulletin for Windows is new. The installers are **not signed** and have only been tried by the people building them.
Only the Claude Code login path has been run end to end against real services; the Anthropic API key and Amazon
Bedrock paths have so far run only against test stand-ins, so expect the first run with your own key to be the first
real test of it.

## What you need first

- **Windows 10 or 11, 64-bit.** The app uses Microsoft's WebView2, which comes with current Windows.
- **Git**, installed so that `git` works in a terminal.
- **One way to pay for model calls** (you choose it on the first-run screen):
  - **Claude Code login.** Install the Claude Code command-line tool (`claude`) and sign in once by running `claude`
    in a terminal. Nothing secret is stored by Bulletin in this mode.
  - **Anthropic API key.** A key from your Anthropic account.
  - **Amazon Bedrock.** A Bedrock bearer token, and the AWS region you use (for example `us-east-1`).
- **A project to work on:** a folder that is a Git repository with at least one commit. To practise, use the sample
  project described under "Your first project".
- **Node.js 22 or newer** if the project you point Bulletin at runs its checks with `npm` or `pnpm` (the sample
  project does). Bulletin itself does not need Node installed; the projects' own checks do.

## Getting the installer

The installers are not published anywhere yet. You either get the file from the person who built it, or build it:

1. Install Node.js 22 or newer, pnpm 10, Git, and the Rust toolchain (`rustc` 1.100 or newer; `rustup` is the usual way).
2. In the repository folder, in a terminal:

   ```powershell
   pnpm install
   pnpm run sidecar:prepare
   pnpm run tauri:build
   ```

   The first command downloads the code the project needs. The second builds the helper program the app runs
   (`bulletin-sidecar`, about 90 MB). The third builds the app and the installers. A full build takes several minutes
   (about 8 on the machine it was tried on).

3. The installers are written to:
   - `src-tauri\target\release\bundle\nsis\Bulletin_0.1.0_x64-setup.exe` (the usual one, about 24 MB)
   - `src-tauri\target\release\bundle\msi\Bulletin_0.1.0_x64_en-US.msi` (the same app as a Windows Installer package)

Later, a release workflow will build these on GitHub and attach them to a release when a version tag is pushed. That
workflow exists only as a draft, `docs/ci-drafts/release.yml`, and is not switched on yet.

If `pnpm` stops with "running scripts is disabled on this system" in PowerShell, Windows is blocking `pnpm.ps1`. Run
`pnpm.cmd` instead (for example `pnpm.cmd install`), or use Command Prompt.

## The Windows warning

Because the installer is not signed, Windows SmartScreen will say "Windows protected your PC" when you run it. That
is Windows telling you it does not know who made the file; it is not a sign that anything is wrong with it. If you
got the file from someone you trust, choose **More info**, then **Run anyway**. Signing needs a code-signing
certificate, which does not exist yet.

## Installing

Run `Bulletin_0.1.0_x64-setup.exe`. It installs just for you, so it does not ask for administrator rights. The
default install folder is `%LOCALAPPDATA%\Bulletin`, which is also where Bulletin keeps its data (see below), so the
two share a folder unless you choose another one in the installer. Besides the install folder it adds a Start menu shortcut, an optional desktop shortcut, and two entries in your user registry
(the uninstall entry shown in Windows Settings, and an install-location entry). It installs `bulletin-desktop.exe`,
`bulletin-sidecar.exe` and a `config` folder holding `models.json` and `prices.json` next to each other.

## First run

Open Bulletin. The first-run screen is reached from **First run** in the bar at the top; it does not open by itself, so
click it the first time.

1. **The checks.** The list shows ticks for "Git is available", "Claude Code CLI is installed" and "Claude Code is
   logged in". The screen will not let you continue until all of them are ticked, even if you pay with a key. If a tick is
   missing, see "When something goes wrong".
2. **Choose how model calls are paid for:** *Claude Code login*, *Anthropic API key*, or *Amazon Bedrock*.
3. **Paste your secret** if you chose a key or Bedrock: *Anthropic API key* takes the key; *Amazon Bedrock* takes the
   bearer token. Click **Save secret**. The field clears and the value is not shown again.
4. **Repository folder.** Type the folder path (for example `D:\work\my-project`). The **Choose folder** button does
   not open a folder window yet, so type or paste the path.
5. **Continue.** This saves your choices and restarts Bulletin's helper program, which only reads the provider when it
   starts. After a moment the app is ready.

Where things are stored:

- **Secrets** go in Windows **Credential Manager** (Windows credentials), under names that contain
  `app.bulletin.desktop`. Only three names are used: `ANTHROPIC_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK` and
  `BULLETIN_GITHUB_TOKEN`. The app hands them to its helper program when it starts it, and never shows them again.
  If the same name is already set as a Windows environment variable, the environment variable wins.
- **Settings** (the provider, the folder, that setup is done) go in a plain file, `settings.json`, in the data
  folder below. It never holds a secret.

What each choice needs:

| Choice | Needs |
| --- | --- |
| Claude Code login | `claude` on your `PATH` and signed in. No key stored. |
| Anthropic API key | The key saved on the first-run screen (`ANTHROPIC_API_KEY`). |
| Amazon Bedrock | The token saved on the first-run screen (`AWS_BEARER_TOKEN_BEDROCK`), and a Windows environment variable `AWS_REGION` such as `us-east-1`. The app cannot set the region for you yet. |

With a key or Bedrock, Bulletin calls the model service directly for the planner and for the building agents. With
the Claude Code login, everything goes through `claude`. If you set the environment variables `BULLETIN_PROVIDER`
(`anthropic` or `bedrock`) or `BULLETIN_RUNNER` (`claude`, `sdk` or `managed`) yourself, they win over the first-run
choice; most people never need them.

## Your first project

Use the sample in `examples/todo-app` (a tiny to-do list with a test). It is a plain folder inside this repository,
not a Git repository on its own, so make a practice copy first. In a terminal:

```powershell
Copy-Item -Recurse examples\todo-app D:\work\todo-practice
cd D:\work\todo-practice
git init
npm install --save-dev vitest
"node_modules" | Out-File -Encoding ascii .gitignore
git add -A
git commit -m "Start"
```

Check that `npm test` passes there, then in Bulletin:

1. Click **New project** in the bar at the top.
2. Type what you want built, for example "Add a way to delete a to-do and show how many are left". Give the folder
   `D:\work\todo-practice` as the code location. **Continue**.
3. Answer the few questions, or **Skip** any. Review the requirements text, fixing anything wrong, then **Make a plan**.
4. Read the proposed plan. It shows the tasks, which files each may touch, and the checks that decide whether each
   task is done, with an estimate of the cost. The project's spending limit (the default is shown on **Settings**) is checked against
   that estimate; if the plan costs more, Bulletin tells you to raise the limit or shrink the plan. Then **Approve plan
   and start**.
5. Watch the project page. When a finished task needs your say-so (for example it changes a protected file), it
   shows under "Held for your OK". When it is all done, review the result in your folder: Bulletin puts finished work
   on a branch named `bulletin/<project id>/integration` in your repository for you to review.

## Where Bulletin keeps its files

The data folder is `%LOCALAPPDATA%\Bulletin` (for example `C:\Users\you\AppData\Local\Bulletin`), the same
folder the installer uses by default. Set the environment variable `BULLETIN_DATA_DIR` to another folder to move the
data. It holds:

- `events.sqlite`: the record of everything that happened in every project (this is what the screens are built from);
- `settings.json`: your first-run choices;
- `scratch\`: working copies of your repositories while agents build, and a `briefings.jsonl` file of the requirements
  texts. Each project has its own folder under `scratch\api\`.

The app's window data (Microsoft WebView2 cache) is kept in `%LOCALAPPDATA%\app.bulletin.desktop`.

## Removing Bulletin

Use **Settings, Apps, Installed apps, Bulletin, Uninstall**, or run `uninstall.exe` in the install folder. It removes
the program files (`bulletin-desktop.exe`, `bulletin-sidecar.exe`, the `config` files and itself), the shortcuts and the
two registry entries. It removes the install folder only if it is then empty, so with the default install location the
folder stays, because your data is in it.

It asks whether to **delete the application data**. If you tick it, it deletes only `app.bulletin.desktop` under
`%APPDATA%` and `%LOCALAPPDATA%` (the window data). **What it leaves behind either way:**

- `%LOCALAPPDATA%\Bulletin` (or your `BULLETIN_DATA_DIR`), with your project history and settings. Delete the folder
  yourself if you want it gone.
- Your saved secrets in Credential Manager. Open Credential Manager, Windows Credentials, and remove the entries that
  mention `app.bulletin.desktop`.
- In your repositories: the `bulletin/...` branches and anything you merged. Remove branches with `git branch -D`
  if you do not want them.

## When something goes wrong

**The app opens but nothing loads, or it says it cannot reach the engine.** The helper program did not start. Check
that the install folder contains `bulletin-sidecar.exe` and a `config` folder with `models.json` and `prices.json`
(reinstalling fixes a missing file). Close and reopen Bulletin; it restarts the helper itself if it stops.

**"Claude Code CLI is installed" has no tick.** Bulletin looks for `claude` on your `PATH` when it starts. Open a
terminal and run `claude --version`. If that fails, install Claude Code. If it works in a terminal but not in the app,
close Bulletin completely and open it again, so it picks up the current `PATH`.

**"Claude Code is logged in" has no tick.** Run `claude` in a terminal and sign in, or run `claude auth status` to
check. Then reopen the first-run screen.

**"Git is available" has no tick.** Install Git for Windows and reopen Bulletin.

**Saving a secret fails.** The message comes from Windows Credential Manager. Values over 1280 characters are refused
(a Windows limit), and only the three secret names above are accepted.

**Bedrock says it is missing something.** Bedrock needs both the token and `AWS_REGION`. Set the region as a Windows
environment variable and reopen Bulletin.

**PowerShell says scripts are disabled when you run `pnpm`.** Use `pnpm.cmd`, as above.

**You chose a key but planning still uses Claude Code.** Your choice is read when the helper starts; **Continue** on the
first-run screen restarts it. If `BULLETIN_PROVIDER` is set in your Windows environment, it takes priority.

If none of that helps, note the time and what you clicked, and look at `events.sqlite` in the data folder only if
you know how: it is a normal SQLite database, and nothing in it is a secret.
