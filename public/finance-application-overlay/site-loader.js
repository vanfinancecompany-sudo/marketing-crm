(() => {
  if (window.__VFC_FINANCE_APPLICATION_OVERLAY__) return;
  window.__VFC_FINANCE_APPLICATION_OVERLAY__ = true;

  const HOST = 'https://marketing-crm-github-work.vercel.app';
  const FRAME_PATH = '/finance-application-overlay/index.html';
  let shell;
  let frame;
  let lastFocus;

  function ensureShell() {
    if (shell) return shell;
    shell = document.createElement('div');
    shell.id = 'vfc-finance-overlay';
    shell.setAttribute('aria-hidden', 'true');
    shell.innerHTML = `
      <style>
        #vfc-finance-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(7,10,15,.62);backdrop-filter:blur(5px)}
        #vfc-finance-overlay[data-open="true"]{display:flex}
        #vfc-finance-overlay iframe{display:block;width:min(940px,calc(100vw - 48px));height:min(900px,calc(100dvh - 48px));border:0;border-radius:25px;background:#fff;box-shadow:0 30px 90px rgba(0,0,0,.32)}
        @media(max-width:600px){#vfc-finance-overlay{padding:0;background:#fff;backdrop-filter:none}#vfc-finance-overlay iframe{width:100vw;height:100dvh;border-radius:0;box-shadow:none}}
      </style>
      <iframe title="Van Finance application" allow="clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    document.body.appendChild(shell);
    frame = shell.querySelector('iframe');
    shell.addEventListener('click', event => { if (event.target === shell) close(); });
    return shell;
  }

  function buildUrl(context = {}) {
    const url = new URL(FRAME_PATH, HOST);
    ['vehicleTitle','vehicleInfo','vehiclePageUrl'].forEach(key => {
      if (context[key]) url.searchParams.set(key, context[key]);
    });
    if (context.preview) url.searchParams.set('preview', '1');
    return url.toString();
  }

  function open(context = {}) {
    ensureShell();
    lastFocus = document.activeElement;
    frame.src = buildUrl(context);
    shell.dataset.open = 'true';
    shell.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
  }

  function close() {
    if (!shell) return;
    shell.dataset.open = 'false';
    shell.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    setTimeout(() => { if (frame) frame.src = 'about:blank'; }, 120);
    try { lastFocus?.focus?.(); } catch (_) {}
  }

  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === 'finance-overlay-close') close();
  });

  window.VFCFinanceApplication = { open, close };
})();
