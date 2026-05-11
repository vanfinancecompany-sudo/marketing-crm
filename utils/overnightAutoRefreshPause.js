const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 7;

function isQuietHours(date = new Date()) {
  const hour = date.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function installOvernightAutoRefreshPause() {
  if (typeof window === "undefined") return;
  if (window.__overnightAutoRefreshPauseInstalled) return;

  window.__overnightAutoRefreshPauseInstalled = true;
  const originalSetInterval = window.setInterval.bind(window);

  window.setInterval = (handler, timeout, ...args) => {
    const guardedHandler = () => {
      if (isQuietHours()) return;

      if (typeof handler === "function") {
        handler(...args);
        return;
      }

      window.eval(handler);
    };

    return originalSetInterval(guardedHandler, timeout);
  };
}

installOvernightAutoRefreshPause();
