(() => {
  const attemptedClass = 'validation-attempted';

  function stepRoot() {
    return document.getElementById('stepRoot');
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function clearFieldState(element) {
    element.classList.remove('is-invalid');
    element.removeAttribute('aria-invalid');
  }

  function nativeInvalid(element) {
    if (!isVisible(element) || element.disabled || element.type === 'hidden') return false;
    try {
      return element.validity ? !element.validity.valid : false;
    } catch (_) {
      return false;
    }
  }

  function customInvalid(element) {
    if (!isVisible(element) || element.disabled || element.type === 'hidden') return false;

    const name = String(element.name || element.id || '').toLowerCase();
    const value = String(element.value || '').trim();

    if (name.includes('email') && value) {
      return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    if (name.includes('phone')) {
      const digits = value.replace(/\D/g, '');
      return digits.length > 0 && digits.length !== 11;
    }

    if ((name.includes('month') || name.includes('months')) && value) {
      const number = Number(value);
      return Number.isFinite(number) && (number < 0 || number > 12);
    }

    if ((name.includes('year') || name.includes('years')) && !name.includes('birth') && value) {
      const number = Number(value);
      return Number.isFinite(number) && (number < 0 || number > 99);
    }

    return false;
  }

  function paintInvalidFields() {
    const root = stepRoot();
    if (!root) return;

    root.classList.add(attemptedClass);

    const controls = [...root.querySelectorAll('input, select, textarea')];
    controls.forEach((element) => {
      const invalid = nativeInvalid(element) || customInvalid(element);
      element.classList.toggle('is-invalid', invalid);
      if (invalid) element.setAttribute('aria-invalid', 'true');
    });

    const firstInvalid = controls.find((element) => element.classList.contains('is-invalid'));
    if (firstInvalid && document.activeElement !== firstInvalid) {
      try {
        firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (_) {}
    }
  }

  function bind() {
    document.addEventListener('input', (event) => {
      if (event.target?.matches?.('input, select, textarea')) clearFieldState(event.target);
    }, true);

    document.addEventListener('change', (event) => {
      if (event.target?.matches?.('input, select, textarea')) clearFieldState(event.target);
    }, true);

    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#continueButton, [data-submit-application], .submit-application');
      if (!button) return;
      window.setTimeout(paintInvalidFields, 0);
      window.setTimeout(paintInvalidFields, 80);
    }, true);

    const root = stepRoot();
    if (root) {
      new MutationObserver(() => {
        root.classList.remove(attemptedClass);
      }).observe(root, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
