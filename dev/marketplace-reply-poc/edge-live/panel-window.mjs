import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export function preparePanelWindowHelper(stateFile) {
  if (process.platform !== "win32") return null;
  const root = process.env.SystemRoot || "C:\\Windows";
  const compiler = ["Framework64", "Framework"].map((folder) =>
    join(root, "Microsoft.NET", folder, "v4.0.30319", "csc.exe")).find(existsSync);
  if (!compiler) return null;
  const source = fileURLToPath(new URL("./restore-monitor-window.cs", import.meta.url));
  const fingerprint = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 16);
  const cache = join(dirname(stateFile), "native");
  const binary = join(cache, "restore-monitor-window-" + fingerprint + ".exe");
  if (!existsSync(binary)) {
    mkdirSync(cache, { recursive: true });
    const pending = binary + "." + process.pid + ".exe";
    const compiled = spawnSync(compiler, ["/nologo", "/target:exe", "/out:" + pending, "/reference:System.Web.Extensions.dll", source], {
      windowsHide: true, timeout: 15_000, encoding: "utf8",
    });
    if (compiled.status !== 0) throw new Error("Could not compile the assistant's Windows recovery helper");
    renameSync(pending, binary);
  }
  return binary;
}

export function openPanelWindow(binary, tabId, onReport, onExit) {
  return new Promise((resolve) => {
    const child = spawn(binary, [String(tabId)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const output = createInterface({ input: child.stdout });
    output.on("line", (line) => {
      let report;
      try { report = JSON.parse(line); } catch { return; }
      onReport(report);
      if (report.outcome === "restored") {
        resolve(report.minimized === false && report.focused === false && report.foregroundPreserved === true);
      }
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => {
      resolve(false);
      onExit(code);
    });
  });
}
