export default function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).send("Method not allowed");
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vansco Live Refresh Runner</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #eef4ff; color: #12213f; }
    main { max-width: 920px; margin: 32px auto; padding: 0 18px; }
    section { background: #fff; border: 1px solid #dbe7fb; border-radius: 20px; padding: 22px; box-shadow: 0 18px 40px rgba(31, 70, 130, 0.12); }
    h1 { margin: 0 0 8px; font-size: 26px; }
    p { margin: 6px 0; color: #53627c; line-height: 1.45; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
    button, a.button-link { display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 12px; padding: 12px 18px; font-weight: 800; cursor: pointer; text-decoration: none; font-size: 14px; }
    .primary { background: #2563eb; color: #fff; }
    .ghost { background: #edf4ff; color: #12325f; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 12px; margin: 18px 0; }
    .card { background: #f8fbff; border: 1px solid #dbe7fb; border-radius: 14px; padding: 14px; }
    .label { color: #67748e; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 26px; font-weight: 900; margin-top: 5px; }
    .bar { height: 12px; border-radius: 999px; background: #dbe7fb; overflow: hidden; margin: 16px 0; }
    .fill { height: 100%; width: 0%; background: #2563eb; transition: width 0.25s ease; }
    pre { background: #101828; color: #d7e4ff; border-radius: 14px; padding: 14px; overflow: auto; min-height: 220px; font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
    .notice { border-radius: 14px; padding: 12px; margin: 14px 0; background: #fff7ed; color: #8a3f00; border: 1px solid #fed7aa; font-weight: 700; }
    .success { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    .error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Vansco Live Refresh Runner</h1>
      <p>Temporary safe test page. One click repeatedly calls the Dragon-first live refresh in small batches until complete or paused.</p>
      <p>It only updates the Vansco cache. It does not add/remove CRM stock, publish to Wix, post to Facebook, or change Ignore/Delete-Block records.</p>

      <div class="actions">
        <button id="start" class="primary" type="button">Start full live refresh</button>
        <button id="pause" class="ghost" type="button" disabled>Pause</button>
        <button id="single" class="ghost" type="button">Run one batch</button>
        <a class="button-link ghost" href="/api/vansco-cache-live-refresh?batchSize=10&refreshUrls=true" target="_blank" rel="noreferrer">Fallback: open one batch</a>
      </div>

      <div id="notice" class="notice">Loading JavaScript...</div>
      <div class="bar"><div id="fill" class="fill"></div></div>

      <div class="grid">
        <div class="card"><div class="label">Batches</div><div id="batches" class="value">0</div></div>
        <div class="card"><div class="label">Processed</div><div id="processed" class="value">0</div></div>
        <div class="card"><div class="label">Success</div><div id="success" class="value">0</div></div>
        <div class="card"><div class="label">Failed</div><div id="failed" class="value">0</div></div>
        <div class="card"><div class="label">Remaining</div><div id="remaining" class="value">-</div></div>
      </div>

      <pre id="log">Waiting for JavaScript...</pre>
    </section>
  </main>

  <script>
    (function () {
      var NL = String.fromCharCode(10);
      var BATCH_SIZE = 10;
      var MAX_BATCHES = 40;
      var DELAY_MS = 1000;
      var running = false;
      var totals = { batches: 0, processed: 0, success: 0, failed: 0, remaining: null };

      function el(id) { return document.getElementById(id); }
      var logEl = el('log');

      window.onerror = function (message, source, line, column) {
        el('notice').className = 'notice error';
        el('notice').textContent = 'JavaScript error: ' + message;
        if (logEl) logEl.textContent = 'JavaScript error at ' + line + ':' + column + ' - ' + message;
      };

      function write(message, payload) {
        var time = new Date().toLocaleTimeString();
        var line = payload
          ? '[' + time + '] ' + message + NL + JSON.stringify(payload, null, 2)
          : '[' + time + '] ' + message;
        logEl.textContent = line + NL + NL + logEl.textContent;
      }

      function render() {
        el('batches').textContent = totals.batches;
        el('processed').textContent = totals.processed;
        el('success').textContent = totals.success;
        el('failed').textContent = totals.failed;
        el('remaining').textContent = totals.remaining == null ? '-' : totals.remaining;
        var totalKnown = totals.remaining == null ? 248 : totals.processed + totals.remaining;
        var pct = totalKnown > 0 ? Math.min(100, Math.round((totals.processed / totalKnown) * 100)) : 0;
        el('fill').style.width = pct + '%';
        el('start').disabled = running;
        el('single').disabled = running;
        el('pause').disabled = !running;
      }

      async function runBatch(refreshUrls) {
        var params = new URLSearchParams({ batchSize: String(BATCH_SIZE), refreshUrls: refreshUrls ? 'true' : 'false' });
        var response = await fetch('/api/vansco-cache-live-refresh?' + params.toString(), { method: 'POST', headers: { accept: 'application/json' } });
        var payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Batch failed');

        totals.batches += 1;
        totals.processed += Number(payload.processedCount || 0);
        totals.success += Number(payload.successCount || 0);
        totals.failed += Number(payload.failureCount || 0);
        totals.remaining = Number(payload.remainingUncheckedOrMissingRegCount || 0);
        render();
        write('Batch ' + totals.batches + ': processed ' + payload.processedCount + ', success ' + payload.successCount + ', failed ' + payload.failureCount + ', remaining ' + totals.remaining + '.', payload);
        return payload;
      }

      async function runLoop() {
        running = true;
        totals = { batches: 0, processed: 0, success: 0, failed: 0, remaining: null };
        el('notice').className = 'notice';
        el('notice').textContent = 'Running full live refresh. Keep this tab open.';
        render();
        write('Started full live refresh.');

        try {
          var shouldContinue = true;
          for (var index = 0; running && shouldContinue && index < MAX_BATCHES; index += 1) {
            var payload = await runBatch(index === 0);
            shouldContinue = Boolean(payload.shouldContinue);
            if (!shouldContinue || payload.complete) break;
            await new Promise(function (resolve) { setTimeout(resolve, DELAY_MS); });
          }

          if (running) {
            el('notice').className = 'notice success';
            el('notice').textContent = totals.remaining === 0 ? 'Complete. Reload Vansco Stock Watch comparison.' : 'Stopped safely. You can press Start again to continue.';
            write('Runner stopped. Remaining: ' + totals.remaining + '.');
          } else {
            el('notice').className = 'notice';
            el('notice').textContent = 'Paused. Press Start to restart from current cache state.';
            write('Paused by user.');
          }
        } catch (error) {
          el('notice').className = 'notice error';
          el('notice').textContent = error.message || 'Runner failed.';
          write('Error: ' + (error.message || 'Runner failed.'));
        } finally {
          running = false;
          render();
        }
      }

      el('start').onclick = runLoop;
      el('pause').onclick = function () { running = false; render(); };
      el('single').onclick = async function () {
        try {
          el('notice').className = 'notice';
          el('notice').textContent = 'Running one batch...';
          await runBatch(true);
          el('notice').className = 'notice success';
          el('notice').textContent = 'One batch complete.';
        } catch (error) {
          el('notice').className = 'notice error';
          el('notice').textContent = error.message || 'Batch failed.';
          write('Error: ' + (error.message || 'Batch failed.'));
        }
      };

      render();
      el('notice').className = 'notice success';
      el('notice').textContent = 'JavaScript ready. Recommended batch size is 10.';
      write('JavaScript ready. Buttons attached.');
    })();
  </script>
</body>
</html>`);
}
