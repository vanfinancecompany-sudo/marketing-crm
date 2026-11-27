# Group Advertising Agent: dedicated Edge profile

The Rent2Buy Group Advertising Agent (VFC Facebook Helper) runs in its own Edge profile,
**Rent2Buy Groups**. This copies the Marketplace Messaging Assistant's setup (Edge profile
"Rent2Buy Assistant.", Startup shortcut, reopen watchdog) and stays independent of it. There
is a separate profile, Startup shortcut, watchdog process and log, and no shared port or files.

| Messaging Assistant | Group Advertising Agent |
|---|---|
| Profile 7, "Rent2Buy Assistant." | Its own profile, "Rent2Buy Groups" |
| `start-assistant.ps1` | `start-groups-agent.ps1` |
| `install-startup.ps1` → "Rent2Buy Marketplace Assistant.lnk" | `install-startup.ps1` → "Rent2Buy Group Advertising Agent.lnk" |
| Service watchdog: reopens Profile 7 after 3 min of silence, at most once per 10 min | `groups-watchdog.ps1`: reopens its profile after 3 min with no open window, at most once per 10 min |

The watchdog checks for the profile's windows by their title suffix
(" - Rent2Buy Groups - Microsoft Edge"), the same way the assistant's window helper
finds its windows. So the helper needs no change, and the watchdog never moves, closes
or focuses any window. It never launches a profile folder that does not exist, because
Edge would create a new empty profile. Log: `%LOCALAPPDATA%\Rent2BuyGroupsAgent\watchdog.log`.

The helper's own off-screen posting window (v1.2.43) still handles rendering inside the profile.

## One-time setup

1. In the everyday profile, open the CRM Groups page. Switch automatic adverts off and click **Revoke background helper**. The CRM accepts only one paired helper.
2. Add an Edge profile named **Rent2Buy Groups**. In it, sign in to Facebook and the Marketing CRM.
3. In that profile, open `edge://extensions` and turn on Developer mode. Click **Load unpacked** and choose the installed VFC Facebook Helper folder. Add no other extensions.
4. In that profile, open the CRM Groups page. Click **Pair background Groups Helper**, then switch automatic adverts on.
5. Install the Startup shortcut and start the watchdog:
   `powershell -ExecutionPolicy Bypass -File install-startup.ps1 -ProfileName "Rent2Buy Groups"`

Start the watchdog without the Startup shortcut: `start-groups-agent.ps1 -EdgeProfile "Profile N" -ServiceOnly`.
Stop it: `start-groups-agent.ps1 -Stop`. Remove it from startup: `install-startup.ps1 -Remove`.
Pause adverts with the CRM's automatic-adverts switch, not by closing the profile.
