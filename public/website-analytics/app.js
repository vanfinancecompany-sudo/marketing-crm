const ENDPOINT = 'https://www.vanfinancecompany.co.uk/_functions/marketingWebsiteAnalytics';

const $ = (id) => document.getElementById(id);

function nav() {
  const config = globalThis.MarketingCrmNavigation;
  const host = $('sidebarNav');
  if (!config || !host) return;
  const current = window.location.pathname;
  host.innerHTML = config.items.map((item) => {
    const active = config.isItemActive(current, item);
    const href = item.href || item.path || '#';
    const external = item.external ? ' target="_blank" rel="noreferrer"' : '';
    return `<a class="marketing-sidebar__link${active ? ' is-active' : ''}${item.variant === 'primary' ? ' is-primary' : ''}" href="${href}"${external}>${item.label}</a>`;
  }).join('');
}

function field(summary, name) {
  const value = Number(summary?.[name]);
  return Number.isFinite(value) ? value : 0;
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function whole(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-GB');
}

function seconds(value) {
  const n = Math.round(Number(value) || 0);
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}m ${s}s`;
}

function delta(current, previous, invert = false) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (!b) return { text: a ? 'New' : '0%', tone: 'neutral' };
  const change = ((a - b) / b) * 100;
  const good = invert ? change < 0 : change > 0;
  return {
    text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
    tone: Math.abs(change) < 0.5 ? 'neutral' : good ? 'good' : 'bad'
  };
}

function metricCard(label, current, previous, formatter, invert = false, note = '') {
  const d = delta(current, previous, invert);
  return `<article class="metric-card">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${formatter(current)}</div>
    <div class="metric-foot"><span class="delta ${d.tone}">${d.text}</span><span>vs previous 7 days</span></div>
    ${note ? `<div class="metric-note">${note}</div>` : ''}
  </article>`;
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    return `${url.pathname || '/'}${url.search ? ' + campaign' : ''}`;
  } catch {
    return String(value || 'Unknown');
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function renderMetrics(data) {
  const c = data.current?.summary || {};
  const p = data.previous?.summary || {};
  const metrics = [
    ['Sessions', field(c, 'traffic.sessions_count'), field(p, 'traffic.sessions_count'), whole, false, 'Visits to the site'],
    ['Unique visitors', field(c, 'traffic.visitors_count'), field(p, 'traffic.visitors_count'), whole, false, 'People rather than page loads'],
    ['Page views', field(c, 'traffic.views_count'), field(p, 'traffic.views_count'), whole, false, 'Total pages viewed'],
    ['Bounce rate', field(c, 'traffic.site_bounce_ratio'), field(p, 'traffic.site_bounce_ratio'), pct, true, 'Lower is generally healthier'],
    ['Avg session', field(c, 'traffic.site_time_seconds_avg'), field(p, 'traffic.site_time_seconds_avg'), seconds, false, 'Average time on site'],
    ['Pages / session', field(c, 'traffic.pages_per_session_avg'), field(p, 'traffic.pages_per_session_avg'), (v) => Number(v || 0).toFixed(1), false, 'Depth of visit']
  ];
  $('metricGrid').innerHTML = metrics.map((m) => metricCard(...m)).join('');
}

function rowPage(item, cols) {
  return `<tr><td class="page-cell" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</td>${cols.map((c) => `<td>${c(item)}</td>`).join('')}</tr>`;
}

function renderTables(data) {
  const c = data.current || {};
  $('landingRows').innerHTML = (c.landingPages || []).map((item) => rowPage(item, [
    (x) => whole(x.sessions), (x) => pct(x.bounceRate)
  ])).join('') || '<tr><td colspan="3">No data yet.</td></tr>';

  $('exitRows').innerHTML = (c.exitPages || []).map((item) => rowPage(item, [
    (x) => whole(x.sessions), (x) => pct(x.exitRate)
  ])).join('') || '<tr><td colspan="3">No data yet.</td></tr>';

  $('pageRows').innerHTML = (c.pages || []).map((item) => rowPage(item, [
    (x) => whole(x.views), (x) => seconds(x.avgTimeSeconds), (x) => pct(x.bounceRate), (x) => pct(x.exitRate)
  ])).join('') || '<tr><td colspan="5">No data yet.</td></tr>';

  $('sourceRows').innerHTML = (c.sources || []).map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${whole(item.sessions)}</td><td>${pct(item.bounceRate)}</td></tr>`).join('') || '<tr><td colspan="3">No data yet.</td></tr>';
  $('deviceRows').innerHTML = (c.devices || []).map((item) => `<tr><td>${escapeHtml(item.device || 'Unknown')}</td><td>${whole(item.sessions)}</td><td>${whole(item.visitors)}</td><td>${pct(item.bounceRate)}</td></tr>`).join('') || '<tr><td colspan="4">No data yet.</td></tr>';

  $('formRows').innerHTML = (c.forms || []).map((item) => `<tr><td title="${escapeHtml(item.url)}">${escapeHtml(item.name || shortUrl(item.url))}</td><td>${whole(item.views)}</td><td>${whole(item.starts)}</td><td>${whole(item.submissions)}</td><td>${pct(item.completionRate)}</td></tr>`).join('') || '<tr><td colspan="5">No Wix Form activity in this period.</td></tr>';
}

function renderFlows(data) {
  const flows = data.current?.userFlows || [];
  $('flowRows').innerHTML = flows.length ? flows.map((flow) => {
    const steps = [flow.entry, flow.first, flow.second, flow.third, flow.fourth].filter(Boolean);
    return `<div class="flow-row"><div class="flow-count">${whole(flow.sessions)} sessions</div><div class="flow-steps">${steps.map((s) => `<span>${escapeHtml(shortUrl(s))}</span>`).join('<b>→</b>')}</div></div>`;
  }).join('') : '<div class="empty">No user-flow data yet.</div>';
}

function previousByUrl(items = []) {
  return new Map(items.map((item) => [shortUrl(item.url), item]));
}

function buildWatchlist(data) {
  const current = data.current || {};
  const previous = data.previous || {};
  const previousPages = previousByUrl(previous.pages || []);
  const findings = [];

  for (const page of current.pages || []) {
    if ((page.views || 0) < 25) continue;
    if ((page.exitRate || 0) >= 0.45) {
      findings.push({ score: (page.views || 0) * (page.exitRate || 0), tone: 'warn', title: `${shortUrl(page.url)} is leaking traffic`, detail: `${whole(page.views)} views, ${pct(page.exitRate)} exit rate.` });
    }
    const old = previousPages.get(shortUrl(page.url));
    if (old?.views && page.views > old.views * 1.25) {
      findings.push({ score: page.views, tone: 'good', title: `${shortUrl(page.url)} is gaining attention`, detail: `Views rose ${delta(page.views, old.views).text} week on week.` });
    }
  }

  const mobile = (current.devices || []).find((x) => String(x.device).toLowerCase() === 'mobile');
  if (mobile && mobile.sessions > 0) {
    const share = mobile.sessions / Math.max(1, field(current.summary, 'traffic.sessions_count'));
    if (share > 0.8) findings.push({ score: 10000, tone: 'info', title: 'Mobile is the website', detail: `${pct(share)} of sessions are mobile. Conversion fixes should be judged mobile-first.` });
  }

  const application = (current.pages || []).find((x) => String(x.url || '').includes('finance-application-received'));
  if (application) findings.push({ score: 9000, tone: 'info', title: 'Completed application signal', detail: `${whole(application.views)} views reached the finance application received page in the settled seven-day window.` });

  return findings.sort((a, b) => b.score - a.score).slice(0, 8);
}

function renderWatchlist(data) {
  const list = buildWatchlist(data);
  $('watchlist').innerHTML = list.length ? list.map((item) => `<div class="watch-item ${item.tone}"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></div>`).join('') : '<div class="empty">No obvious high-volume leaks detected in this window.</div>';
}

function render(data) {
  renderMetrics(data);
  renderTables(data);
  renderFlows(data);
  renderWatchlist(data);
  $('settledLabel').textContent = `Settled through ${data.settledThrough || 'yesterday'}`;
}

async function load() {
  $('refreshButton').disabled = true;
  $('statusDot').className = 'status-dot loading';
  $('statusText').textContent = 'Loading Wix Analytics...';
  try {
    const response = await fetch(`${ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `Analytics returned ${response.status}`);
    render(data);
    $('statusDot').className = 'status-dot ready';
    $('statusText').textContent = 'Wix Analytics connected';
  } catch (error) {
    $('statusDot').className = 'status-dot error';
    $('statusText').textContent = `Analytics unavailable: ${error.message}`;
  } finally {
    $('refreshButton').disabled = false;
  }
}

nav();
$('refreshButton').addEventListener('click', load);
load();
