// Display-only reel card goals calibrated from the last seven complete
// UK days (23-29 October 2026). Intentionally independent of the scheduled
// targets read by Buffer automation in lib/bufferAutomationConfig.js.
//
// DO NOT change the stored schedule, API metrics, publishing workers,
// eligibility safeguards, or historical reporting through these goals.
export const REEL_CARD_GOALS = Object.freeze({
  van_finance_reel: 7,
  rent2buy_reel: 7,
  van_finance_instagram_reel: 6,
});

const UNAVAILABLE_STATES = new Set([
  "CHECKING", "UNAVAILABLE", "NEEDS ATTENTION", "BUFFER COOLDOWN",
]);

export function applyRealisticReelCardGoal(metric, { offDay = false } = {}) {
  if (!metric || !Object.prototype.hasOwnProperty.call(REEL_CARD_GOALS, metric.type) || offDay) {
    return metric;
  }
  const configuredTarget = Math.max(0, Number(metric.target || 0));
  if (!configuredTarget) return metric;

  // Never turn a paused or smaller user-configured schedule into an
  // inflated card target.
  const target = Math.min(REEL_CARD_GOALS[metric.type], configuredTarget);
  const completed = Math.max(0, Number(metric.completed || 0));
  const remaining = Math.max(0, target - completed);
  const preservedStatus = UNAVAILABLE_STATES.has(metric.statusLabel);
  const statusDetail = [
    metric.statusDetail,
    `Card goal ${target} · Buffer scheduling target ${configuredTarget} unchanged`,
  ].filter(Boolean).join(" · ");

  return {
    ...metric,
    target,
    remaining,
    percentage: target > 0 ? Math.min(100, Math.round(100 * completed / target)) : 100,
    statusLabel: preservedStatus ? metric.statusLabel : remaining === 0 ? "COMPLETE" : `${remaining} LEFT`,
    statusDetail,
  };
}
