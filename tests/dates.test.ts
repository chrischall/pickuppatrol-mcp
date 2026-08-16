import { describe, expect, it } from 'vitest';
import { dateToDayId, dayIdToName, nameToDayId, weekdayOf, WEEKDAY_NAMES } from '../src/dates.js';

describe('DayId mapping', () => {
  // The live record that pinned this: DayId 2 arrived carrying
  // WeekDayName "Monday", so the scale is 1-based with Sunday first.
  it('maps DayId 2 to Monday, as the API returns it', () => {
    expect(dayIdToName(2)).toBe('Monday');
  });

  it.each(WEEKDAY_NAMES.map((name, i) => [i + 1, name] as const))(
    'round-trips DayId %i ⇄ %s',
    (dayId, name) => {
      expect(dayIdToName(dayId)).toBe(name);
      expect(nameToDayId(name)).toBe(dayId);
    },
  );

  it.each([0, 8, -1])('rejects out-of-range DayId %i', (dayId) => {
    expect(dayIdToName(dayId)).toBeNull();
  });

  it('accepts a weekday name in any case, with surrounding space', () => {
    expect(nameToDayId('  tUeSdAy ')).toBe(3);
  });

  it('rejects a non-weekday rather than defaulting to Sunday', () => {
    expect(nameToDayId('Caturday')).toBeNull();
  });
});

describe('dateToDayId', () => {
  // 2026-08-17 is a Monday; the plan calendar in the app shows it as such.
  it('reads a calendar date as its weekday', () => {
    expect(dateToDayId('2026-08-17')).toBe(2);
    expect(dateToDayId('2026-08-16')).toBe(1);
    expect(dateToDayId('2026-08-22')).toBe(7);
  });

  it('treats the date as UTC so a local timezone cannot shift the weekday', () => {
    // Run under a US timezone this would be the previous day if parsed local.
    expect(dateToDayId('2026-01-01')).toBe(5); // Thursday
  });

  it.each(['17-08-2026', '2026-8-17', 'tomorrow', ''])('rejects %s', (input) => {
    expect(dateToDayId(input)).toBeNull();
  });

  it('rejects a well-formed but impossible date', () => {
    expect(dateToDayId('2026-13-45')).toBeNull();
  });
});

describe('weekdayOf', () => {
  it('names the weekday of a real date', () => {
    expect(weekdayOf('2026-08-17')).toBe('Monday');
  });

  it('returns null for something that is not a date', () => {
    expect(weekdayOf('2026-13-45')).toBeNull();
  });
});
