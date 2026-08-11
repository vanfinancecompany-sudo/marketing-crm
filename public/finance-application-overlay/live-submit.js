(() => {
  const params = new URLSearchParams(window.location.search);
  const launchToken = params.get('launchToken') || '';
  const isPreview = params.get('preview') === '1';

  if (!launchToken || isPreview) return;

  const STORAGE_KEY = 'financeApplicationOverlayV1';
  const SUBMIT_URL = 'https://www.vanfinancecompany.co.uk/_functions/financeOverlaySubmit';
  const THANK_YOU_URL = 'https://www.vanfinancecompany.co.uk/finance-application-received';
  const button = document.getElementById('continueButton');

  const digitsOnly = value => String(value || '').replace(/\D/g, '');
  const numberValue = value => Number.parseInt(String(value || '0'), 10) || 0;
  const months = (years, monthValue) => numberValue(years) * 12 + numberValue(monthValue);

  function readDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return draft && typeof draft === 'object' ? draft : {};
    } catch (_) {
      return {};
    }
  }

  function readLiveFinalFields() {
    return {
      bank_account_name: document.getElementById('bank_account_name')?.value || '',
      bank_sort_code: document.getElementById('bank_sort_code')?.value || '',
      bank_account_number: document.getElementById('bank_account_number')?.value || '',
      agree_submit: Boolean(document.querySelector('[data-state="agree_submit"]')?.checked)
    };
  }

  function totalAddressMonths(state) {
    return (
      months(state.time_at_address_years, state.time_at_address_months) +
      months(state.previous_address_years, state.previous_address_months) +
      months(state.previous2_address_years, state.previous2_address_months) +
      months(state.previous3_address_years, state.previous3_address_months)
    );
  }

  function buildPayload() {
    const state = readDraft();
    const finalFields = readLiveFinalFields();

    return {
      ...state,
      ...finalFields,
      submitted_at: new Date().toLocaleString('en-GB'),
      application_route: document.getElementById('applicationRoute')?.value || '',
      total_address_months: String(totalAddressMonths(state)),
      vehicle_info: document.getElementById('vehicleInfo')?.value || '',
      vehicle_title: document.getElementById('vehicleTitle')?.value || '',
      vehicle_page_url: document.getElementById('vehiclePageUrl')?.value || '',
      bank_sort_code: digitsOnly(finalFields.bank_sort_code),
      bank_account_number: digitsOnly(finalFields.bank_account_number)
    };
  }

  function showError(message) {
    const element = document.getElementById('validationMessage');
    if (element) element.textContent = message;
    if (button) {
      button.disabled = false;
      button.textContent = 'Submit application';
    }
  }

  function finalBankStepIsVisible() {
    return Boolean(
      document.getElementById('bank_account_name') &&
      document.getElementById('bank_sort_code') &&
      document.getElementById('bank_account_number')
    );
  }

  function finalFieldsAreValid(payload) {
    if (!String(payload.bank_account_name || '').trim()) return 'Please enter the bank account name.';
    if (digitsOnly(payload.bank_sort_code).length !== 6) return 'Please enter a valid 6-digit sort code.';
    if (digitsOnly(payload.bank_account_number).length !== 8) return 'Please enter a valid 8-digit account number.';
    if (!payload.agree_submit) return 'Please agree to the privacy policy before submitting.';
    return '';
  }

  async function submit(payload) {
    const response = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${launchToken}`
      },
      body: JSON.stringify({ payload })
    });

    let result = {};
    try {
      result = await response.json();
    } catch (_) {}

    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.message || 'We could not submit your application. Please try again.');
    }

    return result;
  }

  button?.addEventListener('click', async event => {
    if (!finalBankStepIsVisible()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const payload = buildPayload();
    const validationError = finalFieldsAreValid(payload);
    if (validationError) {
      showError(validationError);
      return;
    }

    button.disabled = true;
    button.textContent = 'Submitting…';

    try {
      await submit(payload);
      localStorage.removeItem(STORAGE_KEY);
      const successLayer = document.getElementById('successLayer');
      if (successLayer) successLayer.hidden = false;

      setTimeout(() => {
        try {
          window.top.location.href = THANK_YOU_URL;
        } catch (_) {
          window.location.href = THANK_YOU_URL;
        }
      }, 1300);
    } catch (error) {
      showError(error?.message || 'We could not submit your application. Please try again.');
    }
  }, true);
})();
