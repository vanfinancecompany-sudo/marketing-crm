const SUMMARY_ENDPOINT = '/api/website-analytics-summary';
const DETAILS_ENDPOINT = '/api/website-analytics-details';

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

function ratio(value) {
  return value === null || value === undefined ? '—' : pct(value);
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

function renderMetrics(summaryData) {
  const c = summaryData?.current?.summary || {};
  const p = summaryData?.previous?.summary || {};
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

function renderFunnel(funnel) {
  const current = funnel?.current || {};
  const previous = funnel?.previous || {};
  const finance = current.finance || {};
  const oldFinance = previous.finance || {};
  const rent = current.rent2buy || {};
  const oldRent = previous.rent2buy || {};

  const financeReached = finance.reachedApplication?.sessions || 0;
  const financeCompleted = finance.completed?.sessions || 0;
  const financeRate = finance.completionRate || 0;
  const oldRate = oldFinance.completionRate || 0;
  const rateDelta = delta(financeRate, oldRate);
  const rentGate = rent.reachedPostcodeGate?.sessions || 0;
  const oldRentGate = oldRent.reachedPostcodeGate?.sessions || 0;
  const rentMeasured = rent.postcodeSupplied !== null && rent.postcodeSupplied !== undefined;
  const rentSupplied = rent.postcodeSupplied?.sessions || 0;
  const rentPass = rent.postcodePass?.sessions || 0;
  const rentFail = rent.postcodeFail?.sessions || 0;
  const rentOpened = rent.fullApplicationOpened?.sessions || 0;
  const rentCompleted = rent.completed?.sessions || 0;
  const rentRate = rent.completionRate;

  $('applicationFunnel').innerHTML = `
    <article class="funnel-card finance">
      <div class="funnel-title">Van Finance</div>
      <div class="funnel-line"><span>Reached application</span><strong>${whole(financeReached)}</strong><small>${delta(financeReached, oldFinance.reachedApplication?.sessions || 0).text} vs prior week</small></div>
      <div class="funnel-arrow">↓</div>
      <div class="funnel-line completed"><span>Completed</span><strong>${whole(financeCompleted)}</strong><small>${delta(financeCompleted, oldFinance.completed?.sessions || 0).text} vs prior week</small></div>
      <div class="funnel-rate"><strong>${pct(financeRate)}</strong><span>application-page session → completion signal</span><em class="delta ${rateDelta.tone}">${rateDelta.text}</em></div>
    </article>
    <article class="funnel-card rent">
      <div class="funnel-title">Rent2Buy</div>
      <div class="funnel-line"><span>Reached postcode gate</span><strong>${whole(rentGate)}</strong><small>${delta(rentGate, oldRentGate).text} vs prior week</small></div>
      <div class="funnel-arrow${rentMeasured ? '' : ' muted'}">↓</div>
      <div class="funnel-line${rentMeasured ? '' : ' muted'}"><span>Postcode supplied</span><strong>${rentMeasured ? whole(rentSupplied) : 'Not measured'}</strong><small>${rentMeasured ? `${whole(rentPass)} pass · ${whole(rentFail)} outside area` : 'Historical Wix data do not expose postcode state'}</small></div>
      <div class="funnel-arrow${rentMeasured ? '' : ' muted'}">↓</div>
      <div class="funnel-line${rentMeasured ? '' : ' muted'}"><span>Full application / completed</span><strong>${rentMeasured ? `${whole(rentOpened)} / ${whole(rentCompleted)}` : 'Not claimed'}</strong><small>${rentMeasured ? 'Explicit first-party events' : 'Available from cutover onward'}</small></div>
      <div class="funnel-rate${rentMeasured ? '' : ' muted'}"><strong>${rentMeasured && rentRate !== null ? pct(rentRate) : '—'}</strong><span>full application opened → completed</span></div>
    </article>`;
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
    (x) => whole(x.sessions), (x) => ratio(x.exitRate)
  ])).join('') || '<tr><td colspan="3">No data yet.</td></tr>';

  $('pageRows').innerHTML = (c.pages || []).map((item) => rowPage(item, [
    (x) => whole(x.views), (x) => seconds(x.avgTimeSeconds), (x) => pct(x.bounceRate), (x) => ratio(x.exitRate)
  ])).join('') || '<tr><td colspan="5">No data yet.</td></tr>';

  $('sourceRows').innerHTML = (c.sources || []).map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${whole(item.sessions)}</td><td>${pct(item.bounceRate)}</td></tr>`).join('') || '<tr><td colspan="3">No data yet.</td></tr>';
  $('deviceRows').innerHTML = (c.devices || []).map((item) => `<tr><td>${escapeHtml(item.device || 'Unknown')}</td><td>${whole(item.sessions)}</td><td>${whole(item.visitors)}</td><td>${pct(item.bounceRate)}</td></tr>`).join('') || '<tr><td colspan="4">No data yet.</td></tr>';

  const formsUnavailable = c.sectionStatus?.forms === 'error';
  $('formRows').innerHTML = (c.forms || []).map((item) => `<tr><td title="${escapeHtml(item.url)}">${escapeHtml(item.name || shortUrl(item.url))}</td><td>${whole(item.views)}</td><td>${whole(item.starts)}</td><td>${whole(item.submissions)}</td><td>${pct(item.completionRate)}</td></tr>`).join('') || `<tr><td colspan="5">${formsUnavailable ? 'Form analytics are temporarily unavailable.' : 'No form activity in this period.'}</td></tr>`;
}

function renderFlows(data) {
  const c = data.current || {};
  const flows = c.userFlows || [];
  if (!flows.length) {
    $('flowRows').innerHTML = `<div class="empty">${c.sectionStatus?.userFlows === 'error' ? 'Visitor-flow analytics are temporarily unavailable.' : 'No user-flow data yet.'}</div>`;
    return;
  }
  $('flowRows').innerHTML = flows.map((flow) => {
    const steps = [flow.entry, flow.first, flow.second, flow.third, flow.fourth].filter(Boolean);
    return `<div class="flow-row"><div class="flow-count">${whole(flow.sessions)} sessions</div><div class="flow-steps">${steps.map((s) => `<span>${escapeHtml(shortUrl(s))}</span>`).join('<b>→</b>')}</div></div>`;
  }).join('');
}

function previousByUrl(items = []) {
  return new Map(items.map((item) => [shortUrl(item.url), item]));
}

function buildWatchlist(data, funnel, summaryData) {
  const current = data.current || {};
  const previous = data.previous || {};
  const previousPages = previousByUrl(previous.pages || []);
  const findings = [];

  const finance = funnel?.current?.finance;
  if (finance?.reachedApplication?.sessions) {
    findings.push({
      score: 12000,
      tone: finance.completionRate < 0.5 ? 'warn' : 'info',
      title: 'Finance application funnel is measurable',
      detail: `${whole(finance.reachedApplication.sessions)} sessions reached a Finance application route and ${whole(finance.completed?.sessions || 0)} reached the completion signal, ${pct(finance.completionRate)} on this session-based funnel.`
    });
  }

  const rent = funnel?.current?.rent2buy;
  if (rent?.reachedPostcodeGate?.sessions) {
    const hasExplicitStages = rent.postcodeSupplied !== null && rent.postcodeSupplied !== undefined;
    findings.push({
      score: 11000,
      tone: 'info',
      title: 'Rent2Buy postcode gate is measurable',
      detail: hasExplicitStages
        ? `${whole(rent.reachedPostcodeGate.sessions)} sessions reached the gate, ${whole(rent.postcodePass?.sessions || 0)} passed and ${whole(rent.completed?.sessions || 0)} completed the application.`
        : `${whole(rent.reachedPostcodeGate.sessions)} sessions reached the postcode gate. Historical Wix page-path data cannot reliably provide the later stages.`
    });
  }

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
  const totalSessions = field(summaryData?.current?.summary || {}, 'traffic.sessions_count');
  if (mobile && mobile.sessions > 0 && totalSessions > 0) {
    const share = mobile.sessions / totalSessions;
    if (share > 0.8) findings.push({ score: 10000, tone: 'info', title: 'Mobile is the website', detail: `${pct(share)} of sessions are mobile. Conversion fixes should be judged mobile-first.` });
  }

  return findings.sort((a, b) => b.score - a.score).slice(0, 8);
}

function renderWatchlist(data, funnel, summaryData) {
  const list = buildWatchlist(data, funnel, summaryData);
  $('watchlist').innerHTML = list.length ? list.map((item) => `<div class="watch-item ${item.tone}"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></div>`).join('') : '<div class="empty">No obvious high-volume leaks detected in this window.</div>';
}

function render(data, summaryData) {
  renderMetrics(summaryData);
  renderFunnel(data.funnel);
  renderTables(data);
  renderFlows(data);
  renderWatchlist(data, data.funnel, summaryData);

  const trafficDate = summaryData?.settledThrough;
  const detailDate = data?.settledThrough || data?.funnel?.settledThrough;
  if (trafficDate && detailDate && trafficDate !== detailDate) {
    $('settledLabel').textContent = `Traffic through ${trafficDate} · detailed tables through ${detailDate}`;
  } else {
    $('settledLabel').textContent = `Settled through ${trafficDate || detailDate || 'yesterday'}`;
  }
}

async function getJson(url) {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}t=${Date.now()}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || data.error || data.ok === false) throw new Error(data.error || data.message || `Request returned ${response.status}`);
  return data;
}

async function load() {
  $('refreshButton').disabled = true;
  $('statusDot').className = 'status-dot loading';
  $('statusText').textContent = 'Loading website analytics...';
  try {
    const [summaryData, detailsData] = await Promise.all([
      getJson(SUMMARY_ENDPOINT),
      getJson(DETAILS_ENDPOINT),
    ]);
    render(detailsData, summaryData);
    $('statusDot').className = 'status-dot ready';
    const sourceLabel = { wix: 'Historical Wix', first_party: 'First-party', mixed: 'Mixed Wix + first-party' }[summaryData.source] || 'Website';
    $('statusText').textContent = `${sourceLabel} analytics connected`;
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
