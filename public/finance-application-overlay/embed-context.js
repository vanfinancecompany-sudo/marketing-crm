(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('embedded') === '1') {
    document.body.classList.add('finance-embedded');
  }
})();
