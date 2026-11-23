# Starts the local assistant service (minimised) and Edge on the given profile.
# The extension opens its own pinned background tab when the service is not Off.
param([string]$EdgeProfile = "Default")
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4618 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath $node -ArgumentList "`"$here\service.mjs`"" -WorkingDirectory $here -WindowStyle Minimized
}
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
Start-Process -FilePath $edge -ArgumentList "--profile-directory=`"$EdgeProfile`""
