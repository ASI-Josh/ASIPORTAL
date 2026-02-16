export const HOURS_PER_WORKDAY = 8;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Converts "work hours" into a real end timestamp by assuming a fixed number of
 * working hours per day, starting each day at the same local time as `startAt`.
 *
 * Example (8h/day):
 * - Start Mon 09:00 + 3h  => Mon 12:00
 * - Start Mon 09:00 + 24h => Wed 17:00 (3 working days)
 */
export function calculateEndFromWorkHours(
  startAt: Date,
  workHours: number,
  workdayHours: number = HOURS_PER_WORKDAY
): Date {
  const startMs = startAt.getTime();
  const hours = Number(workHours);
  const perDay = Number(workdayHours);

  if (!Number.isFinite(startMs)) return new Date();
  if (!Number.isFinite(hours) || hours <= 0) return new Date(startMs);

  if (!Number.isFinite(perDay) || perDay <= 0) {
    return new Date(startMs + hours * HOUR_MS);
  }

  if (hours <= perDay) {
    return new Date(startMs + hours * HOUR_MS);
  }

  const days = Math.ceil(hours / perDay);
  const lastDayHours = hours - (days - 1) * perDay;
  const elapsedHours = (days - 1) * 24 + lastDayHours;
  return new Date(startMs + elapsedHours * HOUR_MS);
}

