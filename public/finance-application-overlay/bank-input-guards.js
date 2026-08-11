(() => {
  function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatSortCode(value) {
    const digits = digitsOnly(value).slice(0, 6);
    return digits.match(/.{1,2}/g)?.join('-') || '';
  }

  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === 'bank_sort_code') {
      target.value = formatSortCode(target.value);
      return;
    }

    if (target.id === 'bank_account_number') {
      target.value = digitsOnly(target.value).slice(0, 8);
    }
  }, true);
})();
