(() => {
  function syncRenderedStateControls() {
    document.querySelectorAll('[data-state]').forEach((element) => {
      if (element.type === 'checkbox') {
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest
      ? event.target.closest('#continueButton')
      : null;

    if (!button) return;
    syncRenderedStateControls();
  }, true);

  const form = document.getElementById('financeForm');
  if (form) {
    form.addEventListener('submit', syncRenderedStateControls, true);
  }
})();
