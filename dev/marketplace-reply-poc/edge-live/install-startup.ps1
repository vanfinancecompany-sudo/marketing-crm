# Adds (or with -Remove, deletes) a shortcut in the current user's Startup folder
# that runs start-assistant.ps1 at logon. Changes nothing else on the PC.
param([string]$EdgeProfile = "Default", [switch]$Remove)
$link = Join-Path ([Environment]::GetFolderPath("Startup")) "Rent2Buy Marketplace Assistant.lnk"
if ($Remove) { Remove-Item $link -ErrorAction SilentlyContinue; "Removed $link"; return }
$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "start-assistant.ps1"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -EdgeProfile `"$EdgeProfile`""
$shortcut.WindowStyle = 7
$shortcut.Save()
"Created $link"
