# Dedicated profile watchdog for the Rent2Buy Group Advertising Agent.
# Modelled on the Marketplace Messaging Assistant's watchdog: closing the dedicated
# profile's last window stops its extension, so if the profile has had no open Edge
# window for 3 minutes, reopen it. At most once every 10 minutes; only its own profile.
# A profile window is recognised by its title suffix " - <profile name> - Microsoft Edge",
# the same way the assistant's window helper finds its own windows. Read-only otherwise:
# it never moves, closes or focuses any window.
param(
  [Parameter(Mandatory = $true)][string]$EdgeProfile,
  [int]$CheckSeconds = 60,
  [int]$SilenceSeconds = 180,
  [int]$CooldownSeconds = 600,
  [string]$UserDataDir = (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"),
  [string]$EdgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  [string]$DataDir = (Join-Path $env:LOCALAPPDATA "Rent2BuyGroupsAgent")
)
if ($EdgeProfile -notmatch '^(?:Default|Profile \d{1,3})$') { throw "Invalid Edge profile folder: $EdgeProfile" }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$log = Join-Path $DataDir "watchdog.log"
function Write-WatchLog([string]$text) {
  try { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss"), $text) -Encoding UTF8 } catch {}
}

# One watchdog per PC user.
$mutex = New-Object System.Threading.Mutex($false, "Local\Rent2BuyGroupsAgentWatchdog")
try { if (-not $mutex.WaitOne(0)) { return } } catch [System.Threading.AbandonedMutexException] {}

if (-not ("GroupsAgentWindows" -as [type])) {
  Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class GroupsAgentWindows {
  private delegate bool Callback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int capacity);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int capacity);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  public static List<string> EdgeTitles() {
    var titles = new List<string>();
    EnumWindows((hwnd, data) => {
      var cls = new StringBuilder(64);
      GetClassName(hwnd, cls, cls.Capacity);
      if (cls.ToString() == "Chrome_WidgetWin_1" && IsWindowVisible(hwnd)) {
        var title = new StringBuilder(512);
        if (GetWindowText(hwnd, title, title.Capacity) > 0) titles.Add(title.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return titles;
  }
}
"@
}

function Get-ProfileName {
  $state = Get-Content -Raw -Path (Join-Path $UserDataDir "Local State") | ConvertFrom-Json
  $info = $state.profile.info_cache."$EdgeProfile"
  if ($info) { return [string]$info.name }
  return $null
}

function Test-ProfileOpen([string]$name) {
  # Edge writes "Microsoft" + zero-width space + " Edge"; match the profile part only.
  $marker = " - $name - Microsoft"
  foreach ($title in [GroupsAgentWindows]::EdgeTitles()) {
    if ($title.Contains($marker) -and $title.EndsWith("Edge")) { return $true }
  }
  return $false
}

Write-WatchLog "watchdog-started profile=$EdgeProfile"
$lastSeen = Get-Date
$lastLaunch = [datetime]::MinValue
$lastProblem = ""
while ($true) {
  $problem = ""
  try {
    $name = Get-ProfileName
    if (-not $name -or -not (Test-Path -LiteralPath (Join-Path $UserDataDir $EdgeProfile))) {
      # Never launch a missing profile folder: Edge would create a new, empty profile.
      $problem = "profile-missing profile=$EdgeProfile"
    } elseif (Test-ProfileOpen $name) {
      $lastSeen = Get-Date
    } else {
      $silent = ((Get-Date) - $lastSeen).TotalSeconds
      if ($silent -ge $SilenceSeconds -and ((Get-Date) - $lastLaunch).TotalSeconds -ge $CooldownSeconds) {
        $lastLaunch = Get-Date
        try {
          Start-Process -FilePath $EdgeExe -ArgumentList "--profile-directory=`"$EdgeProfile`""
          Write-WatchLog ("profile-reopened profile={0} silentFor={1} s" -f $EdgeProfile, [math]::Round($silent))
        } catch {
          Write-WatchLog ("profile-reopen-failed profile={0} error={1}" -f $EdgeProfile, $_.Exception.Message)
        }
      }
    }
  } catch {
    # Local State can be mid-write; try again next minute.
    $problem = "check-failed " + $_.Exception.Message
  }
  if ($problem -ne $lastProblem) { if ($problem) { Write-WatchLog $problem }; $lastProblem = $problem }
  Start-Sleep -Seconds $CheckSeconds
}
