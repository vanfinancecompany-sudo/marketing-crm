using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class RestoreMonitorWindow
{
    private const int ShowNoActivate = 4;
    private const int ShowMinimizedNoActivate = 7;
    private const uint KeepPlacementAndFocus = 0x0001 | 0x0002 | 0x0010;
    private const string WindowSuffix = " - Rent2Buy Assistant. - Microsoft Edge";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4194304 };

    private delegate bool EnumWindowCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int capacity);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr behind, int x, int y, int width, int height, uint flags);

    private static Dictionary<string, object> Status()
    {
        var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4618/status");
        request.Proxy = null;
        request.Timeout = 1800;
        request.ReadWriteTimeout = 1800;
        using (var response = request.GetResponse())
        using (var body = new StreamReader(response.GetResponseStream()))
            return Json.Deserialize<Dictionary<string, object>>(body.ReadToEnd());
    }

    private static string Value(Dictionary<string, object> source, string key)
    {
        object value;
        return source.TryGetValue(key, out value) ? Convert.ToString(value) : "";
    }

    private static Dictionary<string, object> Section(Dictionary<string, object> source, string key)
    {
        object value;
        return source.TryGetValue(key, out value) && value is Dictionary<string, object>
            ? (Dictionary<string, object>)value : new Dictionary<string, object>();
    }

    private static uint AssistantWindowPid(IntPtr window)
    {
        var title = new StringBuilder(1024);
        var windowClass = new StringBuilder(128);
        GetWindowText(window, title, title.Capacity);
        GetClassName(window, windowClass, windowClass.Capacity);
        string label = title.ToString().Replace("\u200b", "");
        if (windowClass.ToString() != "Chrome_WidgetWin_1" ||
            !label.StartsWith("[Assistant] ", StringComparison.Ordinal) ||
            !label.EndsWith(WindowSuffix, StringComparison.Ordinal)) return 0;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        try
        {
            using (var process = Process.GetProcessById((int)pid))
                return process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase) ? pid : 0;
        }
        catch (ArgumentException) { return 0; }
    }

    private static bool SafeStatus(Dictionary<string, object> status, string tabId)
    {
        var account = Section(status, "account");
        var heartbeat = Section(status, "heartbeat");
        DateTimeOffset lastBeat;
        return Value(status, "mode") == "auto" && Value(status, "dedicatedProfile") == "True" &&
            Value(status, "safetyStop") == "" &&
            Value(account, "authorised") != "" && Value(account, "authorised") == Value(account, "signedIn") &&
            Value(account, "problem") == "" && Value(heartbeat, "health") == "healthy" &&
            DateTimeOffset.TryParse(Value(heartbeat, "at"), out lastBeat) &&
            (DateTimeOffset.UtcNow - lastBeat).TotalSeconds < 150 &&
            Value(heartbeat, "url") == "/marketplace/you/selling" &&
            tabId != "" && Value(Section(status, "tabCensus"), "assistantTabId") == tabId &&
            Value(Section(status, "tabCensus"), "pinnedFacebookTabs") == "1";
    }

    private static int Main(string[] args)
    {
        int tabId;
        if (args.Length != 1 || !Int32.TryParse(args[0], out tabId) || tabId <= 0) return 2;
        try { return Recover(args[0]); }
        catch (Exception error)
        {
            Console.WriteLine(Json.Serialize(new { outcome = "error", reason = error.GetType().Name }));
            return 1;
        }
    }

    private static int Recover(string tabId)
    {
        var baseline = Status();
        string listBefore = Value(Section(baseline, "heartbeat"), "list");
        if (!SafeStatus(baseline, tabId) || (listBefore != "none" && listBefore != "chats")) return 2;
        var matches = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            if (AssistantWindowPid(window) != 0) matches.Add(window);
            return true;
        }, IntPtr.Zero);
        if (matches.Count != 1 || !IsIconic(matches[0])) return 3;
        IntPtr target = matches[0];
        uint edgePid = AssistantWindowPid(target);
        IntPtr foreground = GetForegroundWindow();
        if (edgePid == 0 || foreground == target || foreground == IntPtr.Zero) return 4;
        bool recovered = false;
        bool focused = false;
        bool minimized = false;
        int rows = 0;
        string lastList = listBefore;
        string visibility = "";
        var startedAt = DateTimeOffset.UtcNow;
        bool foregroundPreserved = false;
        if (!SetWindowPos(target, foreground, 0, 0, 0, 0, KeepPlacementAndFocus)) return 5;
        try
        {
            if (!ShowWindowAsync(target, ShowNoActivate)) return 6;
            Thread.Sleep(350);
            foregroundPreserved = GetForegroundWindow() == foreground;
            focused = GetForegroundWindow() == target;
            Console.WriteLine(Json.Serialize(new { outcome = "restored", foregroundPreserved, focused, minimized = IsIconic(target), tabId }));
            if (focused || IsIconic(target)) return 7;
            while ((DateTimeOffset.UtcNow - startedAt).TotalSeconds < 27)
            {
                focused = GetForegroundWindow() == target;
                if (focused || AssistantWindowPid(target) != edgePid || IsIconic(target)) break;
                var current = Status();
                if (!SafeStatus(current, tabId)) break;
                var heartbeat = Section(current, "heartbeat");
                lastList = Value(heartbeat, "list");
                visibility = Value(heartbeat, "visibility");
                DateTimeOffset observedAt;
                if (lastList == "marketplace" && Int32.TryParse(Value(heartbeat, "rows"), out rows) && rows > 0 &&
                    DateTimeOffset.TryParse(Value(heartbeat, "at"), out observedAt) && observedAt >= startedAt)
                {
                    recovered = true;
                    break;
                }
                Thread.Sleep(200);
            }
        }
        finally
        {
            if (AssistantWindowPid(target) == edgePid && GetForegroundWindow() != target && !IsIconic(target))
                ShowWindowAsync(target, ShowMinimizedNoActivate);
            Thread.Sleep(350);
            minimized = IsIconic(target);
            Console.WriteLine(Json.Serialize(new { outcome = "finished", tabId, recovered, focused, minimized,
                foregroundPreserved, foregroundUnchanged = GetForegroundWindow() == foreground, list = lastList, visibility, rows }));
        }
        return recovered && minimized && !focused ? 0 : 8;
    }
}
