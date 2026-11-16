// Supplemental daily journeys. Website traffic baselines stay with GA4.
(() => {
  const ENDPOINT = '/api/website-customer-journeys';
  const LABELS = { vanFinance: 'Van Finance', rent2buy: 'Rent2Buy' };
  const nf = new Intl.NumberFormat('en-GB');
  let period = 'yesterday';
  let snapshot = null;

  function el(id) { return document.getElementById(id); }
  function safe(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function num(value) { return nf.format(Number(value || 0)); }
  function currentSite() {
    return document.querySelector('.site-tab.is-active')?.dataset?.site || 'all';
  }
  function siteEntries() {
    if (!snapshot) return [];
    const key = currentSite();
    return Object.entries(snapshot.sites || {})
      .filter(([siteKey]) => key === 'all' || key === siteKey);
  }
  function availableSites() { return siteEntries().filter(([, site]) => site?.ok); }
  function card(label, value, note) {
    return '<div class="journey-stat"><span>' + safe(label) + '</span><strong>' +
      safe(value) + '</strong><small>' + safe(note) + '</small></div>';
  }
  function entry(label, count, subtitle = '') {
    return '<div class="journey-entry"><span>' +
      (subtitle ? '<small>' + safe(subtitle) + '</small> · ' : '') +
      safe(label) + '</span><strong>' + num(count) + '</strong></div>';
  }
  function sectionEmpty(message) { return '<div class="journey-empty">' + safe(message) + '</div>'; }


  function renderMobileStock(entries) {
    const labels = [
      ['observedMobileHomepageSessions', 'Homepage confirmed by page event'],
      ['stockListingSessions', 'Then viewed stock listings / categories'],
      ['vehicleDetailSessions', 'Then viewed an individual van'],
      ['applicationEntrySessions', 'Then reached / opened application'],
      ['deliberateApplicationStartSessions', 'Then deliberately started application'],
      ['applicationCompletionSessions', 'Then recorded completion signal'],
    ];
    return entries.map(([key, site]) => {
      if (!site?.ok) return '<div class="journey-mobile-site">' + sectionEmpty((LABELS[key] || key) + ': journey data unavailable.') + '</div>';
      const funnel = site.mobileStockJourney;
      if (!funnel) return '<div class="journey-mobile-site">' + sectionEmpty((LABELS[key] || key) + ': funnel data unavailable.') + '</div>';
      const observed = Number(funnel.observedMobileHomepageSessions || 0);
      const captured = Number(funnel.capturedMobileHomepageSessions || 0);
      const percent = captured ? (100 * observed / captured).toFixed(1) + '%' : '—';
      const note = key === 'vanFinance'
        ? 'Application entry = page reached; deliberate start is a separate signal.'
        : 'Rent2Buy application entry and start both mean full application opened.';
      return '<div class="journey-mobile-site"><h4>' + safe(LABELS[key] || key) + '</h4>' +
        '<p>' + num(captured) + ' mobile homepage landing sessions; ' + num(observed) +
        ' have an explicit homepage page_view (' + safe(percent) + ' coverage).</p>' +
        (observed ? labels.map(([field, label]) => {
          const count = Number(funnel[field] || 0);
          const rate = (100 * count / observed).toFixed(1);
          return entry(label, count, rate + '% of observed homepage sessions');
        }).join('') : sectionEmpty('Not enough verified homepage page events to assess the mobile stock journey. This does not establish zero traffic or zero conversions.')) +
        '<p class="journey-mobile-caveat">' + safe(note) + ' These are same-session observations after the homepage, not proven clicks, a strictly sequential funnel or CRM-confirmed applications.</p></div>';
    }).join('');
  }

  function render() {
    if (!snapshot) return;
    const entries = siteEntries();
    const available = availableSites();
    if (!available.length) {
      el('journeySummary').innerHTML = sectionEmpty('First-party journey data is unavailable for the selected website.');
      el('journeyQuality').innerHTML = '';
      el('journeyMobileStock').innerHTML = '';
      el('journeyRoutes').innerHTML = sectionEmpty('No verified route coverage available.');
      el('journeyPopular').innerHTML = '';
      el('journeySources').innerHTML = '';
      return;
    }

    const sum = (field) => available.reduce((total, [, site]) => total + Number(site[field] || 0), 0);
    const totalSessions = sum('capturedSessions');
    const withPages = sum('sessionsWithPageEvent');
    const gap = sum('sessionsMissingPageEvent');
    const coverage = totalSessions ? (100 * withPages / totalSessions).toFixed(1) + '%' : '—';
    el('journeySummary').innerHTML = [
      card('Captured sessions', num(totalSessions), 'First-party signals; unverified human traffic'),
      card('Sessions with page events', num(withPages), coverage + ' of captured sessions'),
      card('Page events', num(sum('recordedPageEvents')), 'Not equivalent to GA4 page views'),
      card('Application entry signals', num(sum('applicationStartSessions')), 'VFC page reached · Rent2Buy form opened'),
      card('Completion signals', num(sum('applicationCompletionEvents')), 'Tracking events, not confirmed CRM deals'),
    ].join('');

    const quality = [];
    for (const [key, site] of entries) {
      if (!site?.ok) {
        quality.push('<div class="journey-quality-item">' + safe(LABELS[key] || key) + ': first-party data temporarily unavailable.</div>');
        continue;
      }
      const missing = Number(site.sessionsMissingPageEvent || 0);
      const total = Number(site.capturedSessions || 0);
      const counter = Number(site.pageViewCounters || 0);
      if (!total) {
        quality.push('<div class="journey-quality-item">' + safe(LABELS[key]) + ': no captured sessions in this period. This does not mean there were no visitors.</div>');
      } else if (missing > 0) {
        const special = !site.recordedPageEvents && counter > 0
          ? ' The website has page-view counters, but no detailed page_view events for reconstructing journeys.'
          : ' These visits cannot be included in detailed page-by-page routes.';
        quality.push('<div class="journey-quality-item"><strong>' + safe(LABELS[key]) +
          ' tracking gap:</strong> ' + num(missing) + ' of ' + num(total) +
          ' sessions have no explicit page_view event.' + safe(special) + '</div>');
      } else {
        quality.push('<div class="journey-quality-item ok">' + safe(LABELS[key]) +
          ': all captured sessions have an explicit page event; this does not independently validate human traffic.</div>');
      }
      const unknown = (site.sources || []).find((row) => row.source === 'Direct / unknown');
      if (unknown && total > 0 && unknown.count / total >= 0.5) {
        quality.push('<div class="journey-quality-item">' + safe(LABELS[key]) +
          ': ' + num(unknown.count) + ' sessions have direct/unknown source classification. Attribution remains incomplete.</div>');
      }
    }
    el('journeyQuality').innerHTML = quality.join('');
    el('journeyMobileStock').innerHTML = renderMobileStock(entries);

    const names = currentSite() === 'all';
    const routes = available.flatMap(([key, site]) => (site.routes || []).map((route) => ({ ...route, siteKey: key })))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 10);
    el('journeyRoutes').innerHTML = routes.length ? routes.map((row) => {
      const steps = row.steps.map((step, i) => (i ? '<b aria-hidden="true">→</b>' : '') + '<span>' + safe(step) + '</span>').join('');
      return '<div class="journey-entry route">' +
        (names ? '<small>' + safe(LABELS[row.siteKey]) + '</small>' : '') +
        '<div class="journey-pills">' + steps + '</div><strong>' + num(row.sessions) +
        ' sessions</strong></div>';
    }).join('') : sectionEmpty('No repeated page-to-page routes can be confirmed yet. Routes appear only when detailed page events exist for at least 3 sessions.');

    const landing = available.flatMap(([key, site]) => (site.topLandingPages || []).map((row) => ({ ...row, key })))
      .sort((a, b) => b.count - a.count).slice(0, 5);
    const vehicles = available.flatMap(([key, site]) => (site.topVehicles || []).map((row) => ({ ...row, key })))
      .sort((a, b) => b.count - a.count).slice(0, 4);
    el('journeyPopular').innerHTML = '<h4>Entry pages</h4>' +
      (landing.length ? landing.map((row) => entry(row.path, row.count, names ? LABELS[row.key] : '')).join('')
        : sectionEmpty('No landing page groups yet.')) +
      '<h4>Vehicle views</h4>' +
      (vehicles.length ? vehicles.map((row) => entry(row.registration, row.count, names ? LABELS[row.key] : '')).join('')
        : sectionEmpty('No vehicle-view event groups of 3 or more yet. This does not mean there were no vehicle views.'));
    const sources = available.flatMap(([key, site]) => (site.sources || []).map((row) => ({ ...row, key })))
      .sort((a, b) => b.count - a.count).slice(0, 9);
    el('journeySources').innerHTML = sources.length
      ? sources.map((row) => entry(row.source, row.count, names ? LABELS[row.key] : '')).join('')
      : sectionEmpty('No source signals in this period.');
    const periodLabel = snapshot.period?.label || 'Selected period';
    el('journeyStatus').textContent = periodLabel +
      ' · first-party signals · ' + num(gap) + ' sessions lack detailed page events' +
      (snapshot.period?.provisional ? ' · today is still in progress' : '');
  }

  async function load() {
    el('journeyStatus').textContent = 'Loading daily first-party customer journeys…';
    try {
      const response = await fetch(ENDPOINT + '?period=' + encodeURIComponent(period), {
        cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.message || 'The journey feed is unavailable.');
      snapshot = data;
      render();
    } catch {
      snapshot = null;
      el('journeyStatus').textContent = 'Daily customer journeys are temporarily unavailable. GA4 reports above remain separate.';
      el('journeySummary').innerHTML = sectionEmpty('Could not load the first-party journey feed.');
      el('journeyQuality').innerHTML = '';
      el('journeyMobileStock').innerHTML = '';
      el('journeyRoutes').innerHTML = '';
      el('journeyPopular').innerHTML = '';
      el('journeySources').innerHTML = '';
    }
  }

  document.querySelectorAll('[data-journey-period]').forEach((button) => {
    button.addEventListener('click', () => {
      period = button.dataset.journeyPeriod || 'yesterday';
      document.querySelectorAll('[data-journey-period]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      load();
    });
  });
  el('siteTabs')?.addEventListener('click', () => queueMicrotask(render));
  el('refreshButton')?.addEventListener('click', load);
  load();
})();