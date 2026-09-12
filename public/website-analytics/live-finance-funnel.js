(() => {
  const ENDPOINT = '/api/finance-application-funnel';
  let latest = null;
  let timer = null;

  function installStyles() {
    if (document.getElementById('liveFinanceFunnelStyles')) return;
    const style = document.createElement('style');
    style.id = 'liveFinanceFunnelStyles';
    style.textContent = `
      .live-finance-funnel{margin-top:14px;padding:16px;border:1px solid #dfe4ea;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(16,24,40,.04)}
      .live-finance-funnel[hidden]{display:none}.live-finance-funnel__head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.live-finance-funnel__head strong{display:block;color:#101828;font-size:15px}.live-finance-funnel__head small{display:block;margin-top:3px;color:#667085}.live-finance-funnel__score{font-weight:900;color:#101828;white-space:nowrap}
      .live-finance-funnel__steps{display:grid;gap:9px}.live-finance-step{display:grid;grid-template-columns:minmax(150px,1.4fr) minmax(120px,2fr) auto;gap:12px;align-items:center}.live-finance-step__name{font-size:13px;font-weight:800;color:#344054}.live-finance-step__track{height:10px;border-radius:999px;background:#eef2f6;overflow:hidden}.live-finance-step__bar{height:100%;border-radius:999px;background:#d71920;min-width:2px}.live-finance-step__count{font-size:12px;font-weight:800;color:#344054;white-space:nowrap}.live-finance-step__blocked{color:#b42318}.live-finance-funnel__breakdown{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.live-finance-chip{padding:5px 8px;border-radius:999px;background:#fff4ed;color:#b42318;font-size:11px;font-weight:800}.live-finance-funnel__note{margin-top:12px;color:#667085;font-size:11px;line-height:1.45}
      @media(max-width:700px){.live-finance-step{grid-template-columns:1fr auto}.live-finance-step__track{grid-column:1/-1;grid-row:2}.live-finance-funnel__head{display:block}.live-finance-funnel__score{display:block;margin-top:6px;white-space:normal}}
    `;
    document.head.appendChild(style);
  }

  function ensureElement() {
    const anchor = document.getElementById('liveCompletionStatus') || document.getElementById('applicationFunnel');
    if (!anchor) return null;
    let element = document.getElementById('liveFinanceFunnel');
    if (element) return element;
    element = document.createElement('div');
    element.id = 'liveFinanceFunnel';
    element.className = 'live-finance-funnel';
    element.setAttribute('aria-live', 'polite');
    anchor.insertAdjacentElement('afterend', element);
    return element;
  }

  function selectedSite() {
    return document.querySelector('.site-tab.is-active')?.dataset?.site || 'all';
  }

  function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function render() {
    const element = ensureElement();
    if (!element) return;
    const selected = selectedSite();
    element.hidden = selected === 'rent2buy';
    if (element.hidden) return;
    element.replaceChildren();

    const head = document.createElement('div');
    head.className = 'live-finance-funnel__head';
    const title = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = 'Live finance application journey · today';
    const small = document.createElement('small');
    small.textContent = latest
      ? 'Page reach is separate from a deliberate start. A start begins when the customer chooses an application type.'
      : 'Waiting for live step telemetry.';
    title.append(strong, small);
    const score = document.createElement('span');
    score.className = 'live-finance-funnel__score';
    score.textContent = latest
      ? `${latest.reaches || 0} reached · ${latest.starts || 0} started · ${latest.completions || 0} completed · ${percent(latest.conversionRate)}`
      : 'Loading…';
    head.append(title, score);
    element.appendChild(head);

    if (!latest?.steps?.length) {
      const note = document.createElement('div');
      note.className = 'live-finance-funnel__note';
      note.textContent = 'Step-by-step tracking will populate as customers use the instrumented finance application.';
      element.appendChild(note);
      return;
    }

    const steps = document.createElement('div');
    steps.className = 'live-finance-funnel__steps';
    const max = Math.max(1, latest.starts || 0, ...latest.steps.map((step) => Number(step.viewed || 0)));
    for (const step of latest.steps) {
      const row = document.createElement('div');
      row.className = 'live-finance-step';
      const name = document.createElement('span');
      name.className = 'live-finance-step__name';
      name.textContent = step.name;
      const track = document.createElement('div');
      track.className = 'live-finance-step__track';
      const bar = document.createElement('div');
      bar.className = 'live-finance-step__bar';
      bar.style.width = `${Math.max(2, Math.round((Number(step.viewed || 0) / max) * 100))}%`;
      track.appendChild(bar);
      const count = document.createElement('span');
      count.className = 'live-finance-step__count';
      count.textContent = step.name === 'Application type'
        ? `${step.viewed || 0} started`
        : `${step.viewed || 0} reached`;
      if (Number(step.blocked || 0) > 0) {
        const blocked = document.createElement('span');
        blocked.className = 'live-finance-step__blocked';
        blocked.textContent = ` · ${step.blocked} blocked`;
        count.appendChild(blocked);
      }
      row.append(name, track, count);
      steps.appendChild(row);
    }
    element.appendChild(steps);

    const breakdown = [...(latest.blockedDevices || []).map((item) => `${item.name} ${item.sessions}`), ...(latest.blockedBrowsers || []).map((item) => `${item.name} ${item.sessions}`)];
    if (breakdown.length) {
      const wrap = document.createElement('div');
      wrap.className = 'live-finance-funnel__breakdown';
      for (const label of breakdown) {
        const chip = document.createElement('span');
        chip.className = 'live-finance-chip';
        chip.textContent = `Blocked: ${label}`;
        wrap.appendChild(chip);
      }
      element.appendChild(wrap);
    }

    const note = document.createElement('div');
    note.className = 'live-finance-funnel__note';
    note.textContent = '“Blocked” means the form showed a validation or submission error on that step. No application-type choice, names, contact details, bank details or typed answers are stored in this funnel.';
    element.appendChild(note);
  }

  async function load() {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error('Live funnel unavailable.');
      latest = payload;
    } catch {
      latest = null;
    }
    render();
  }

  installStyles();
  load();
  document.getElementById('refreshButton')?.addEventListener('click', () => window.setTimeout(load, 50));
  document.getElementById('siteTabs')?.addEventListener('click', () => window.setTimeout(render, 50));
  timer = window.setInterval(load, 60 * 1000);
  window.addEventListener('pagehide', () => { if (timer) window.clearInterval(timer); }, { once: true });
})();
