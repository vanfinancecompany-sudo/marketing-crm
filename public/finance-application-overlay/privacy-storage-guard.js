(() => {
  const STORAGE_KEY = 'financeApplicationOverlayV1';
  const nativeSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function guardedFinanceDraftSetItem(key, value) {
    if (key !== STORAGE_KEY) {
      return nativeSetItem.call(this, key, value);
    }

    try {
      const draft = JSON.parse(value);

      if (draft && typeof draft === 'object') {
        delete draft.bank_account_name;
        delete draft.bank_sort_code;
        delete draft.bank_account_number;
        delete draft.agree_submit;
        return nativeSetItem.call(this, key, JSON.stringify(draft));
      }
    } catch (_) {
      // Fall through to the original write if the value is not JSON.
    }

    return nativeSetItem.call(this, key, value);
  };
})();
