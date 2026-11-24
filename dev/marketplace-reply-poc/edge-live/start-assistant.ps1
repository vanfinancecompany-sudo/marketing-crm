# Starts the local assistant service (minimised) and Edge on the given profile.
# The extension opens its own pinned background tab when the service is not Off.
# -ServiceOnly: start only the service (used at Windows logon; Edge is opened by the owner).
param([string]$EdgeProfile = "Default", [switch]$ServiceOnly)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4618 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $node -ArgumentList "`"$here\service.mjs`"" -WorkingDirectory $here -WindowStyle Minimized
}
if ($ServiceOnly) { return }
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
Start-Process -FilePath $edge -ArgumentList "--profile-directory=`"$EdgeProfile`""
