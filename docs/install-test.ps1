$ErrorActionPreference = "Continue"
$installer = "D:\wt-claude\src-tauri\target\release\bundle\nsis\Bulletin_0.1.0_x64-setup.exe"
$scratch = Join-Path $env:TEMP "bulletin-install-test"
$data = Join-Path $env:TEMP "bulletin-install-test-data"
$webview = Join-Path $env:TEMP "bulletin-install-test-webview"
$log = Join-Path $env:TEMP "bulletin-install-test.log"
Remove-Item $log -ErrorAction SilentlyContinue
function Say($t) { $line = "$(Get-Date -Format HH:mm:ss) $t"; Write-Output $line; Add-Content $log $line }

function Snapshot {
  $s = [ordered]@{}
  $s.Uninstall = @(Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName } | Sort-Object)
  $s.SoftwareBulletin = @(Get-ChildItem "HKCU:\Software\bulletin" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object)
  $s.Run = @((Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object { $_.Name -notlike "PS*" } | ForEach-Object { $_.Name } | Sort-Object)
  $s.StartMenu = @(Get-ChildItem (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs") -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName } | Sort-Object)
  $s.Desktop = @(Get-ChildItem ([Environment]::GetFolderPath("Desktop")) -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object)
  $s.RealData = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA "Bulletin") -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) $($_.Length) $($_.LastWriteTimeUtc.Ticks)" } | Sort-Object)
  $s.WebViewDir = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA "app.bulletin.desktop") -ErrorAction SilentlyContinue | ForEach-Object { $_.Name } | Sort-Object)
  $s
}

if (Test-Path $scratch) { Say "scratch already exists, stopping"; exit 2 }
if (Test-Path "HKCU:\Software\bulletin\Bulletin") { Say "a Bulletin install is already registered, stopping"; exit 3 }
$before = Snapshot
Say "baseline: uninstall entries $($before.Uninstall.Count), start menu items $($before.StartMenu.Count), desktop items $($before.Desktop.Count)"

# 1. install
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $installer -ArgumentList "/S", "/D=$scratch" -PassThru -Wait
Say "install exit code $($p.ExitCode) in $([int]$sw.Elapsed.TotalSeconds)s"
Say "installed files: $((Get-ChildItem $scratch -Recurse -File | ForEach-Object { $_.FullName.Substring($scratch.Length + 1) }) -join ', ')"
$afterInstall = Snapshot
foreach ($k in $before.Keys) {
  $d = Compare-Object @($before[$k]) @($afterInstall[$k])
  if ($d) { Say "after install, $k changed: $(($d | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join ' | ')" }
}

# 2. launch the installed app with scratch data and webview folders, wait, check the sidecar
New-Item -ItemType Directory -Force $data, $webview | Out-Null
$env:BULLETIN_DATA_DIR = $data
$env:WEBVIEW2_USER_DATA_FOLDER = $webview
$app = Start-Process -FilePath (Join-Path $scratch "bulletin-desktop.exe") -PassThru
$sidecarOk = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  $sc = Get-CimInstance Win32_Process -Filter "Name='bulletin-sidecar.exe'" | Where-Object { $_.ExecutablePath -like "$scratch*" }
  if ($sc -and (Test-Path (Join-Path $data "events.sqlite"))) { $sidecarOk = $true; break }
}
Say "app pid $($app.Id) running=$(-not $app.HasExited); sidecar from the install folder running and wrote events.sqlite to the scratch data folder: $sidecarOk"
$scPids = @($sc | ForEach-Object { $_.ProcessId })
# stop only the processes this script started
if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
Start-Sleep -Seconds 3
foreach ($id in $scPids) { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { Say "sidecar $id survived the app; stopping it"; Stop-Process -Id $id -Force } else { Say "sidecar $id ended with the app" } }
Remove-Item Env:BULLETIN_DATA_DIR, Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 3. uninstall (silent: the delete-app-data box is not shown, so nothing outside the install is deleted)
$u = Start-Process -FilePath (Join-Path $scratch "uninstall.exe") -ArgumentList "/S" -PassThru -Wait
Say "uninstall exit code $($u.ExitCode)"
for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $scratch "bulletin-desktop.exe")); $i++) { Start-Sleep -Seconds 1 }
Start-Sleep -Seconds 5
$left = if (Test-Path $scratch) { @(Get-ChildItem $scratch -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) } else { @("(folder gone)") }
Say "left in the install folder after uninstall: $($left -join ', ')"
$afterUninstall = Snapshot
$clean = $true
foreach ($k in $before.Keys) {
  $d = Compare-Object @($before[$k]) @($afterUninstall[$k])
  if ($d) { $clean = $false; Say "after uninstall, $k differs from baseline: $(($d | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join ' | ')" }
}
Say "registry, Start menu, desktop, real data folder and webview folder identical to baseline: $clean"

# 4. remove only what this script created
Remove-Item $scratch, $data, $webview -Recurse -Force -ErrorAction SilentlyContinue
Say "scratch folders removed: $(-not (Test-Path $scratch))"
