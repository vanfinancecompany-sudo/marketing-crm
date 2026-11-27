# Adds (or with -Remove, deletes) a shortcut in the current user's Startup folder that runs
# start-groups-agent.ps1 at logon. Modelled on the Marketplace Messaging Assistant's installer;
# it has its own shortcut name and changes nothing else on the PC.
# -ProfileName resolves the Edge profile folder from its display name (e.g. "Rent2Buy Groups").
param([string]$EdgeProfile = "", [string]$ProfileName = "", [switch]$Remove, [switch]$ServiceOnly)
$link = Join-Path ([Environment]::GetFolderPath("Startup")) "Rent2Buy Group Advertising Agent.lnk"
if ($Remove) { Remove-Item $link -ErrorAction SilentlyContinue; "Removed $link"; return }
if ($ProfileName) {
  $state = Get-Content -Raw (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Local State") | ConvertFrom-Json
  $found = @($state.profile.info_cache.PSObject.Properties | Where-Object { $_.Value.name -eq $ProfileName })
  if ($found.Count -ne 1) { throw "Expected exactly one Edge profile named '$ProfileName', found $($found.Count)" }
  $EdgeProfile = $found[0].Name
}
if ($EdgeProfile -notmatch '^(?:Default|Profile \d{1,3})$') { throw "Pass -ProfileName or -EdgeProfile" }
$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "start-groups-agent.ps1"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -EdgeProfile `"$EdgeProfile`"" + $(if ($ServiceOnly) { " -ServiceOnly" } else { "" })
$shortcut.WindowStyle = 7
$shortcut.Save()
"Created $link for $EdgeProfile"
