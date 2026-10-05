export const BUFFER_ACTIVE_START_MINUTES = 7 * 60;
export const BUFFER_ACTIVE_END_MINUTES = 23 * 60 + 15;

export function londonClockParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function londonMinutesOfDay(value = new Date()) {
  const { hour, minute } = londonClockParts(value);
  return (hour * 60) + minute;
}

export function isBufferApiActiveWindow(value = new Date()) {
  const minutes = londonMinutesOfDay(value);
  return minutes >= BUFFER_ACTIVE_START_MINUTES && minutes < BUFFER_ACTIVE_END_MINUTES;
}

export function isBufferScheduledRunDue(kind, value = new Date()) {
  if (!isBufferApiActiveWindow(value)) return false;
  const { hour } = londonClockParts(value);

  switch (String(kind || "")) {
    case "vfc-facebook":
      // Keep a final 22:00 London refill available for same-day catch-up.
      // Nothing is intentionally scheduled beyond the current UK calendar day.
      return hour >= 7 && hour <= 22;
    case "two-hour":
      return [7, 9, 11, 13, 15, 17, 19, 21, 22].includes(hour);
    case "four-hour-plus-final":
      return [7, 11, 15, 19, 21, 22].includes(hour);
    case "status":
      return true;
    default:
      return true;
  }
}

export function bufferDormantPayload(extra = {}) {
  return {
    ok: true,
    dormant: true,
    activeWindow: "07:00-23:15 Europe/London",
    ...extra,
  };
}
