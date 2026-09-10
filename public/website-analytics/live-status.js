(() => {
  const ENDPOINT = '/api/ga4-pipeline-summary';
  let latest = null;
  let timer = null;

  function installStyles() {
    if (document.getElementById('liveCompletionStatusStyles')) return;
    const style = document.createElement('style');
    style.id = 'liveCompletionStatusStyles';
    style.textContent = '.live-completion-status{display:grid;gap:4px;margin-top:12px;padding:12px 14px;border:1px solid #dfe4ea;border-left:4px solid #667085;border-radius:10px;background:#f8fafc;color:#344054}.live-completion-status strong{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#101828}.live-completion-status span{font-size:14px;font-weight:800}.live-completion-status small{font-size:11px;line-height:1.45;color:#667085}.live-completion-status.is-live-ahead{border-left-color:#1b8f4d;background:#f2fbf5}.live-completion-status.is-live-ahead strong{color:#197543}';
    document.head.appendChild(style);
  }

  function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !window.MarketingCrmSidebarRenderer?.render) return;
    window.MarketingCrmSidebarRenderer.render(sidebar, { pathname: window.location.pathname });
  }

  function statusElement() {
    const funnel = document.getElementById('applicationFunnel');
    if (!funnel) return null;
    let element = document.getElementById('liveCompletionStatus');
    if (element) return element;
    element = document.createElement('div');
    element.id = 'liveCompletionStatus';
    element.className = 'live-completion-status';
    element.setAttribute('aria-live', 'polite');
    funnel.insertAdjacentElement('afterend', element);
    return element;
  }

  function selectedSite() {
    return document.querySelector('.site-tab.is-active')?.dataset?.site || 'all';
  }

  function siteLabel(site) {
    return site?.key === 'rent2buy' ? 'Rent2Buy Vans' : 'Van Finance Company';
  }

  function renderStatus() {
    const element = statusElement();
    if (!element || !latest) return;
    const selected = selectedSite();
    const sites = (latest.sites || []).filter((site) => selected === 'all' || site.key === selected);
    element.replaceChildren();

    const strong = document.createElement('strong');
    strong.textContent = 'Today · live application confirmations';
    element.appendChild(strong);

    const summary = document.createElement('span');
    summary.textContent = sites.length
      ? sites.map((site) => `${siteLabel(site)} ${Number(site.applicationCompletionsToday || 0)} completed`).join(' · ')
      : 'No live application feed available';
    element.appendChild(summary);

    const note = document.createElement('small');
    const delayed = sites.some((site) => site.applicationCompletionSource === 'first_party_live');
    note.textContent = delayed
      ? 'A completed application has been confirmed by the live first-party tracker while GA4 is still processing it. The settled seven-day GA4 counters above intentionally stop at yesterday.'
      : 'Today is shown separately because the weekly GA4 counters above use settled data through yesterday.';
    element.appendChild(note);
    element.classList.toggle('is-live-ahead', delayed);
  }

  async function load() {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.message || 'Live completion feed unavailable.');
      latest = payload;
      renderStatus();
    } catch {
      const element = statusElement();
      if (element) {
        element.replaceChildren();
        const strong = document.createElement('strong');
        strong.textContent = 'Today · live application confirmations';
        const note = document.createElement('small');
        note.textContent = 'Live confirmation is temporarily unavailable. Settled GA4 reporting above is unaffected.';
        element.append(strong, note);
      }
    }
  }

  installStyles();
  renderSidebar();
  load();
  document.getElementById('refreshButton')?.addEventListener('click', () => window.setTimeout(load, 50));
  document.getElementById('siteTabs')?.addEventListener('click', () => window.setTimeout(renderStatus, 50));
  timer = window.setInterval(load, 60 * 1000);
  window.addEventListener('pagehide', () => { if (timer) window.clearInterval(timer); }, { once: true });
})();
