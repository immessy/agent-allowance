import { DomainError } from "./errors";

export interface UtcMonthWindow {
  start: Date;
  endExclusive: Date;
  startIso: string;
  endExclusiveIso: string;
}

function assertValidDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainError("INVALID_TIMESTAMP", `${label} is not a valid Date.`);
  }
  return value;
}

function parseTimestamp(timestamp: Date | string): Date {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return assertValidDate(date, "timestamp");
}

/**
 * Computes UTC calendar month boundaries `[start, endExclusive)` for an injected `now` timestamp.
 */
export function getUtcMonthWindow(now: Date): UtcMonthWindow {
  const validNow = assertValidDate(now, "now");
  const start = new Date(
    Date.UTC(validNow.getUTCFullYear(), validNow.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const endExclusive = new Date(
    Date.UTC(validNow.getUTCFullYear(), validNow.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return {
    start,
    endExclusive,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString(),
  };
}

/**
 * Returns true if `timestamp` falls within the UTC calendar month containing `now`.
 */
export function isTimestampInUtcMonth(
  timestamp: Date | string,
  now: Date
): boolean {
  const targetMs = parseTimestamp(timestamp).getTime();
  const window = getUtcMonthWindow(now);
  return (
    targetMs >= window.start.getTime() &&
    targetMs < window.endExclusive.getTime()
  );
}

