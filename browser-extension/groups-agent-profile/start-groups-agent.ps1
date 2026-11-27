# Starts the Group Advertising Agent's profile watchdog (hidden) and Edge on its dedicated profile.
# Modelled on the Marketplace Messaging Assistant's start-assistant.ps1; the two are independent.
# -ServiceOnly: start only the watchdog.  -Stop: stop the watchdog (Edge is left alone).
param([string]$EdgeProfile = "", [switch]$ServiceOnly, [switch]$Stop)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchdog = Join-Path $here "groups-watchdog.ps1"
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -like "*groups-watchdog.ps1*" })
if ($Stop) {
  $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  "Stopped $($running.Count) watchdog process(es)"
  return
}
if ($EdgeProfile -notmatch '^(?:Default|Profile \d{1,3})$') { throw "Pass the dedicated profile folder, e.g. -EdgeProfile `"Profile 8`"" }
if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\$EdgeProfile"))) {
  throw "Edge profile folder '$EdgeProfile' does not exist"
}
if (-not $running.Count) {
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -EdgeProfile `"$EdgeProfile`""
}
if ($ServiceOnly) { return }
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
Start-Process -FilePath $edge -ArgumentList "--profile-directory=`"$EdgeProfile`""
