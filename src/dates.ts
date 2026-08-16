/**
 * Weekday helpers for PickUp Patrol's `DayId`.
 *
 * `DayId` is 1-based with **Sunday = 1** — verified against a live record
 * (`DayId: 2` carrying `WeekDayName: "Monday"`), and matching the SPA, which
 * renders the label as `dayNamesMin[DayId - 1]`.
 */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** `DayId` → weekday name, or `null` when the id is outside 1–7. */
export function dayIdToName(dayId: number): WeekdayName | null {
  return WEEKDAY_NAMES[dayId - 1] ?? null;
}

/**
 * Weekday name → `DayId`. Case-insensitive; returns `null` for anything that
 * is not a weekday, so a typo surfaces as a validation error rather than
 * silently writing to Sunday.
 */
export function nameToDayId(name: string): number | null {
  const index = WEEKDAY_NAMES.findIndex((d) => d.toLowerCase() === name.trim().toLowerCase());
  return index === -1 ? null : index + 1;
}

/** `YYYY-MM-DD` → `DayId`, treating the date as a plain calendar date (UTC). */
export function dateToDayId(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).getUTCDay() + 1;
}

/**
 * `YYYY-MM-DD` → weekday name, or `null` when the string is not a real date.
 *
 * Exists so callers get the name in one expression: folding the two steps
 * together at each call site leaves a `?? 0` fallback that is unreachable
 * wherever the date has already been validated, and an unreachable branch is
 * one nothing can prove the behaviour of.
 */
export function weekdayOf(isoDate: string): WeekdayName | null {
  const dayId = dateToDayId(isoDate);
  return dayId === null ? null : dayIdToName(dayId);
}
