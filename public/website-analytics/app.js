const GA4_ENDPOINT = '/api/ga4-website-analytics';
const SUPPLEMENTAL_DETAILS_ENDPOINT = '/api/website-analytics-details';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-GB');
let ga4Data = null;
let supplementalData = null;
let selectedSite = 'all';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtNumber(value, digits = 0) {
  const number = Number(value || 0);
  return digits ? number.toFixed(digits) : nf.format(Math.round(number));
}

function fmtPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(number * 100)}%`;
}

function fmtDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  if (!minutes) return `${remainder}s`;
  return `${minutes}m ${remainder}s`;
}

function delta(current, previous, lowerIsBetter = false) {
  const a = Number(current || 0);
  const b = Number(previous || 0);
  if (!b) return { text: a ? 'Building history' : '0%', tone: 'neutral' };
  const pct = ((a - b) / b) * 100;
  const improved = lowerIsBetter ? pct < 0 : pct > 0;
  return {
    text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
    tone: Math.abs(pct) < 0.1 ? 'neutral' : improved ? 'good' : 'bad',
  };
}

function metricCard({ label, current, previous, format = fmtNumber, note, lowerIsBetter = false }) {
  const change = delta(current, previous, lowerIsBetter);
  return `<article class="metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(format(current))}</div>
    <div class="metric-foot"><span class="delta ${change.tone}">${escapeHtml(change.text)}</span><span>vs previous 7 days</span></div>
    <div class="metric-note">${escapeHtml(note)}</div>
  </article>`;
}

function aggregateSummary(sites, period = 'current') {
  const rows = sites.map((site) => site?.[period]?.summary).filter(Boolean);
  const sessions = rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0);
  const activeUsers = rows.reduce((sum, row) => sum + Number(row.activeUsers || 0), 0);
  const pageViews = rows.reduce((sum, row) => sum + Number(row.pageViews || 0), 0);
  const weighted = (field) => {
    if (!sessions) return 0;
    return rows.reduce((sum, row) => sum + Number(row[field] || 0) * Number(row.sessions || 0), 0) / sessions;
  };
  return {
    sessions,
    activeUsers,
    pageViews,
    bounceRate: weighted('bounceRate'),
    averageSessionDuration: weighted('averageSessionDuration'),
    pagesPerSession: sessions ? pageViews / sessions : 0,
  };
}

function configuredSites() {
  return (ga4Data?.sites || []).filter((site) => site?.configured);
}

function visibleSites() {
  const sites = configuredSites();
  return selectedSite === 'all' ? sites : sites.filter((site) => site.key === selectedSite);
}

function summaryFor(period) {
  const sites = visibleSites();
  if (!sites.length) return {};
  if (sites.length === 1) return sites[0]?.[period]?.summary || {};
  return aggregateSummary(sites, period);
}

function renderMetrics() {
  const current = summaryFor('current');
  const previous = summaryFor('previous');
  $('metricGrid').innerHTML = [
    metricCard({ label: 'Sessions', current: current.sessions, previous: previous.sessions, note: 'GA4 sessions' }),
    metricCard({ label: 'Active users', current: current.activeUsers, previous: previous.activeUsers, note: 'GA4 active users' }),
    metricCard({ label: 'Page views', current: current.pageViews, previous: previous.pageViews, note: 'Total pages viewed' }),
    metricCard({ label: 'Bounce rate', current: current.bounceRate, previous: previous.bounceRate, format: fmtPct, note: 'Lower is generally healthier', lowerIsBetter: true }),
    metricCard({ label: 'Avg session', current: current.averageSessionDuration, previous: previous.averageSessionDuration, format: fmtDuration, note: 'Average GA4 session duration' }),
    metricCard({ label: 'Pages / session', current: current.pagesPerSession, previous: previous.pagesPerSession, format: (value) => Number(value || 0).toFixed(1), note: 'Depth of visit' }),
  ].join('');

  $('combinedNote').textContent = selectedSite === 'all'
    ? (ga4Data?.note || 'Combined totals add the two GA4 properties.')
    : `Showing ${visibleSites()[0]?.label || 'selected website'} only.`;
}

function eventDelta(current, previous) {
  if (current == null || previous == null) return { text: 'No comparison yet', tone: 'neutral' };
  return delta(current, previous, false);
}

function funnelCard(site) {
  const current = site?.current?.events || {};
  const previous = site?.previous?.events || {};
  const rate = current.conversionRate;
  const previousRate = previous.conversionRate;
  const change = eventDelta(rate, previousRate);
  const tone = site.key === 'rent2buy' ? 'rent' : 'finance';
  return `<article class="funnel-card ${tone}">
    <div class="funnel-title">${escapeHtml(site.label)}</div>
    <div class="funnel-line">
      <span>Application started</span><strong>${fmtNumber(current.applicationStarts)}</strong>
      <small>${escapeHtml(delta(current.applicationStarts, previous.applicationStarts).text)} vs previous week</small>
    </div>
    <div class="funnel-arrow">↓</div>
    <div class="funnel-line">
      <span>Application completed</span><strong>${fmtNumber(current.applicationCompletions)}</strong>
      <small>${escapeHtml(delta(current.applicationCompletions, previous.applicationCompletions).text)} vs previous week</small>
    </div>
    <div class="funnel-rate${rate == null ? ' muted' : ''}">
      <strong>${rate == null ? '—' : fmtPct(rate)}</strong>
      <span>GA4 start → completion</span>
      <em class="delta ${change.tone}">${escapeHtml(change.text)}</em>
    </div>
  </article>`;
}

function renderFunnel() {
  const sites = visibleSites();
  const container = $('applicationFunnel');
  container.classList.toggle('single', sites.length === 1);
  container.innerHTML = sites.length ? sites.map(funnelCard).join('') : '<div class="empty">GA4 application data is not available yet.</div>';
}

function watchItem(tone, title, text) {
  return `<div class="watch-item ${tone}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

function renderWatchlist() {
  const sites = visibleSites();
  const items = [];

  for (const site of sites) {
    const current = site.current || {};
    const previous = site.previous || {};
    const currentSummary = current.summary || {};
    const previousSummary = previous.summary || {};
    const events = current.events || {};
    const previousEvents = previous.events || {};

    if (!previousSummary.sessions && currentSummary.sessions) {
      items.push(watchItem('info', `${site.label}: GA4 history is building`, `${fmtNumber(currentSummary.sessions)} sessions are recorded in the current settled window; the previous seven-day GA4 comparison is still sparse.`));
    } else if (previousSummary.sessions) {
      const trafficChange = ((Number(currentSummary.sessions || 0) - Number(previousSummary.sessions || 0)) / Number(previousSummary.sessions || 1)) * 100;
      items.push(watchItem(trafficChange >= 0 ? 'good' : 'warn', `${site.label}: traffic ${trafficChange >= 0 ? 'up' : 'down'}`, `${fmtNumber(currentSummary.sessions)} sessions, ${Math.abs(trafficChange).toFixed(1)}% ${trafficChange >= 0 ? 'above' : 'below'} the previous seven days.`));
    }

    if (events.applicationStarts) {
      const currentRate = Number(events.conversionRate || 0);
      const previousRate = previousEvents.conversionRate;
      const comparison = previousRate == null ? 'Previous-period conversion is not established yet.' : `${delta(currentRate, previousRate).text} versus the previous seven days.`;
      items.push(watchItem(currentRate >= 0.35 ? 'good' : 'warn', `${site.label}: application conversion`, `${fmtNumber(events.applicationStarts)} starts produced ${fmtNumber(events.applicationCompletions)} completions (${fmtPct(currentRate)}). ${comparison}`));
    } else {
      items.push(watchItem('info', `${site.label}: application event baseline`, 'No application_start event is present in this settled seven-day window yet. Keep an eye on this as the new GA4 event history builds.'));
    }

    const leak = (current.landingPages || [])
      .filter((row) => Number(row.sessions || 0) >= 3)
      .sort((a, b) => Number(b.bounceRate || 0) - Number(a.bounceRate || 0))[0];
    if (leak && Number(leak.bounceRate || 0) >= 0.7) {
      items.push(watchItem('warn', `${site.label}: high-bounce entry`, `${leak.path || '/'} has ${fmtNumber(leak.sessions)} landing sessions and ${fmtPct(leak.bounceRate)} bounce.`));
    }

    const mobile = (current.devices || []).find((row) => String(row.device).toLowerCase() === 'mobile');
    const totalDeviceSessions = (current.devices || []).reduce((sum, row) => sum + Number(row.sessions || 0), 0);
    if (mobile && totalDeviceSessions) {
      const share = Number(mobile.sessions || 0) / totalDeviceSessions;
      if (share >= 0.65) items.push(watchItem('info', `${site.label}: mobile dominates`, `${fmtPct(share)} of device-attributed sessions are mobile, so mobile journey checks should carry the most weight.`));
    }
  }

  $('watchlist').innerHTML = items.length ? items.slice(0, 8).join('') : '<div class="empty">No conversion warnings yet.</div>';
}

function siteTag(site) {
  return `<span class="site-pill ${site.key === 'rent2buy' ? 'rent' : 'finance'}">${site.key === 'rent2buy' ? 'Rent2Buy' : 'Van Finance'}</span>`;
}

function flattenRows(field) {
  return visibleSites().flatMap((site) => (site.current?.[field] || []).map((row) => ({ ...row, site })));
}

function emptyRow(columns, text = 'No GA4 data in this settled window.') {
  return `<tr><td colspan="${columns}"><div class="empty">${escapeHtml(text)}</div></td></tr>`;
}

function renderLandingRows() {
  const rows = flattenRows('landingPages').sort((a, b) => Number(b.sessions || 0) - Number(a.sessions || 0)).slice(0, 20);
  $('landingRows').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td>${siteTag(row.site)}</td><td class="page-cell" title="${escapeHtml(row.path)}">${escapeHtml(row.path || '/')}</td>
    <td>${fmtNumber(row.sessions)}</td><td>${fmtPct(row.bounceRate)}</td>
  </tr>`).join('') : emptyRow(4);

  const leaks = flattenRows('landingPages')
    .filter((row) => Number(row.sessions || 0) >= 2)
    .sort((a, b) => Number(b.bounceRate || 0) - Number(a.bounceRate || 0) || Number(b.sessions || 0) - Number(a.sessions || 0))
    .slice(0, 20);
  $('exitRows').innerHTML = leaks.length ? leaks.map((row) => `<tr>
    <td>${siteTag(row.site)}</td><td class="page-cell" title="${escapeHtml(row.path)}">${escapeHtml(row.path || '/')}</td>
    <td>${fmtNumber(row.sessions)}</td><td>${fmtPct(row.bounceRate)}</td>
  </tr>`).join('') : emptyRow(4);
}

function renderPageRows() {
  const rows = flattenRows('pages').sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 30);
  $('pageRows').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td>${siteTag(row.site)}</td><td class="page-cell" title="${escapeHtml(row.path)}">${escapeHtml(row.path || '/')}</td>
    <td>${fmtNumber(row.views)}</td><td>${fmtNumber(row.activeUsers)}</td><td>${fmtDuration(row.avgEngagementSeconds)}</td>
  </tr>`).join('') : emptyRow(5);
}

function renderSourceRows() {
  const rows = flattenRows('sources').sort((a, b) => Number(b.sessions || 0) - Number(a.sessions || 0)).slice(0, 25);
  $('sourceRows').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td>${siteTag(row.site)}</td><td>${escapeHtml(row.source || 'Direct / unknown')}</td><td>${fmtNumber(row.sessions)}</td><td>${fmtPct(row.bounceRate)}</td>
  </tr>`).join('') : emptyRow(4);
}

function renderDeviceRows() {
  const rows = flattenRows('devices').sort((a, b) => Number(b.sessions || 0) - Number(a.sessions || 0));
  $('deviceRows').innerHTML = rows.length ? rows.map((row) => `<tr>
    <td>${siteTag(row.site)}</td><td>${escapeHtml(row.device || 'unknown')}</td><td>${fmtNumber(row.sessions)}</td><td>${fmtNumber(row.activeUsers)}</td><td>${fmtPct(row.bounceRate)}</td>
  </tr>`).join('') : emptyRow(5);
}

function renderFlows() {
  if (selectedSite !== 'all') {
    $('flowRows').innerHTML = '<div class="empty">The supplemental journey feed is combined across the legacy first-party tracker. Switch to All websites to view it without pretending it is site-separated GA4 data.</div>';
    return;
  }
  const rows = supplementalData?.current?.userFlows || [];
  $('flowRows').innerHTML = rows.length ? rows.slice(0, 20).map((row) => {
    const steps = [row.entry, row.first, row.second, row.third, row.fourth].filter(Boolean);
    return `<div class="flow-row"><div class="flow-count">${fmtNumber(row.sessions)} sessions</div><div class="flow-steps">${steps.map((step, index) => `${index ? '<b>→</b>' : ''}<span>${escapeHtml(step)}</span>`).join('')}</div></div>`;
  }).join('') : '<div class="empty">No supplemental first-party journey sequences available.</div>';
}

function renderApplicationRows() {
  const sites = visibleSites();
  $('formRows').innerHTML = sites.length ? sites.map((site) => {
    const events = site.current?.events || {};
    return `<tr>
      <td>${siteTag(site)}</td><td>${fmtNumber(events.applicationStarts)}</td><td>${fmtNumber(events.applicationCompletions)}</td>
      <td>${fmtNumber(events.generateLead)}</td><td>${fmtNumber(events.proofsReceived)}</td><td>${events.conversionRate == null ? '—' : fmtPct(events.conversionRate)}</td>
    </tr>`;
  }).join('') : emptyRow(6);
}

function renderAll() {
  renderMetrics();
  renderFunnel();
  renderWatchlist();
  renderLandingRows();
  renderPageRows();
  renderSourceRows();
  renderDeviceRows();
  renderFlows();
  renderApplicationRows();
}

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload;
}

async function loadAnalytics() {
  const button = $('refreshButton');
  button.disabled = true;
  $('statusDot').className = 'status-dot loading';
  $('statusText').textContent = 'Loading GA4 Analytics...';

  try {
    const [ga4, supplemental] = await Promise.all([
      getJson(GA4_ENDPOINT),
      getJson(SUPPLEMENTAL_DETAILS_ENDPOINT).catch(() => null),
    ]);
    ga4Data = ga4;
    supplementalData = supplemental;

    const sites = configuredSites();
    const failed = (ga4.sites || []).filter((site) => !site.configured);
    $('statusDot').className = failed.length && sites.length ? 'status-dot loading' : sites.length ? 'status-dot ready' : 'status-dot error';
    $('statusText').textContent = sites.length === 2
      ? 'GA4 connected · Van Finance + Rent2Buy'
      : sites.length === 1
        ? `GA4 connected · ${sites[0].label} · other property unavailable`
        : 'GA4 unavailable';
    $('settledLabel').textContent = ga4.settledThrough ? `Settled through ${ga4.settledThrough}` : '';
    renderAll();
  } catch (error) {
    ga4Data = null;
    $('statusDot').className = 'status-dot error';
    $('statusText').textContent = `GA4 analytics unavailable: ${error.message}`;
    $('settledLabel').textContent = '';
    $('metricGrid').innerHTML = '<div class="empty">Could not load GA4 website analytics.</div>';
  } finally {
    button.disabled = false;
  }
}

function initTabs() {
  $('siteTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-site]');
    if (!button) return;
    selectedSite = button.dataset.site || 'all';
    document.querySelectorAll('.site-tab').forEach((tab) => tab.classList.toggle('is-active', tab === button));
    if (ga4Data) renderAll();
  });
}

function initSidebar() {
  if (!window.MarketingSidebarNavigation?.render) return;
  window.MarketingSidebarNavigation.render({ containerId: 'sidebarNav', currentId: 'website-analytics' });
}

$('refreshButton').addEventListener('click', loadAnalytics);
initSidebar();
initTabs();
loadAnalytics();
