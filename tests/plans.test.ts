import { describe, expect, it } from 'vitest';
import { McpToolError } from '@chrischall/mcp-utils';
import {
  applyDefaultPlans,
  assertTransportationAllowed,
  buildPlanUpdates,
  clearDefaultPlans,
  DEFAULT_PLAN_LABEL,
  normalizeCarNumber,
  normalizeEarlyDismissal,
  normalizeNote,
} from '../src/plans.js';
import type { Student, Transportation } from '../src/types.js';

const student: Student = {
  StudentId: 1050046,
  SchoolId: 1703,
  FirstName: 'Lucas',
  LastName: 'Hall',
  AllowPlans: true,
  LimitedIds: [],
  DefaultPlans: [
    { DayId: 2, TransportationId: 41246, TransportationName: 'PickUp', Note: 'Chris Hall' },
    { DayId: 3, TransportationId: 41245, TransportationName: 'Bus', Note: null },
  ],
};

function option(overrides: Partial<Transportation> = {}): Transportation {
  return {
    TransportationId: 41246,
    SchoolId: 1703,
    Name: 'PickUp',
    IsActive: true,
    ...overrides,
  };
}

describe('buildPlanUpdates', () => {
  it('builds one entry per date, matching the payload the web app sends', () => {
    expect(
      buildPlanUpdates({
        student,
        dates: ['2026-08-17', '2026-08-18'],
        transportation: option(),
        note: 'Chris Hall',
      }),
    ).toEqual([
      {
        StudentId: 1050046,
        SchoolId: 1703,
        PlanDate: '2026-08-17',
        TransportationId: 41246,
        TransportationName: 'PickUp',
        Note: 'Chris Hall',
      },
      {
        StudentId: 1050046,
        SchoolId: 1703,
        PlanDate: '2026-08-18',
        TransportationId: 41246,
        TransportationName: 'PickUp',
        Note: 'Chris Hall',
      },
    ]);
  });

  it('reverts to the default plan with a null transportation and no note', () => {
    expect(
      buildPlanUpdates({ student, dates: ['2026-08-17'], transportation: null, note: 'ignored' }),
    ).toEqual([
      {
        StudentId: 1050046,
        SchoolId: 1703,
        PlanDate: '2026-08-17',
        TransportationId: null,
        TransportationName: DEFAULT_PLAN_LABEL,
        Note: null,
      },
    ]);
  });

  it('omits EarlyDismissalTime and CarNumber entirely when they do not apply', () => {
    const [plan] = buildPlanUpdates({
      student,
      dates: ['2026-08-17'],
      transportation: option(),
      earlyDismissalTime: '13:00',
      carNumber: '42',
    });
    expect(plan).not.toHaveProperty('EarlyDismissalTime');
    expect(plan).not.toHaveProperty('CarNumber');
  });

  it('sends an early-dismissal time as HH:MM:SS', () => {
    const [plan] = buildPlanUpdates({
      student,
      dates: ['2026-08-17'],
      transportation: option({ IsEarlyDismissal: true }),
      earlyDismissalTime: '13:05',
    });
    expect(plan?.EarlyDismissalTime).toBe('13:05:00');
  });

  it('passes an already-seconds time through unchanged', () => {
    const [plan] = buildPlanUpdates({
      student,
      dates: ['2026-08-17'],
      transportation: option({ IsEarlyDismissal: true }),
      earlyDismissalTime: '13:05:30',
    });
    expect(plan?.EarlyDismissalTime).toBe('13:05:30');
  });

  it('sends a car number for options that use them', () => {
    const [plan] = buildPlanUpdates({
      student,
      dates: ['2026-08-17'],
      transportation: option({ UseCarNumbers: true }),
      carNumber: ' 42 ',
    });
    expect(plan?.CarNumber).toBe('42');
  });

  it('omits a blank car number rather than sending an empty string', () => {
    const [plan] = buildPlanUpdates({
      student,
      dates: ['2026-08-17'],
      transportation: option({ UseCarNumbers: true }),
      carNumber: '   ',
    });
    expect(plan).not.toHaveProperty('CarNumber');
  });

  it('rejects an empty date list', () => {
    expect(() => buildPlanUpdates({ student, dates: [], transportation: option() })).toThrow(
      /No dates given/,
    );
  });

  it('rejects a malformed date', () => {
    expect(() =>
      buildPlanUpdates({ student, dates: ['17/08/2026'], transportation: option() }),
    ).toThrow(/not a YYYY-MM-DD date/);
  });

  it('rejects a date that is shaped right but is not a real day', () => {
    expect(() =>
      buildPlanUpdates({ student, dates: ['2026-13-45'], transportation: option() }),
    ).toThrow(/not a YYYY-MM-DD date/);
  });

  it('rejects a repeated date, which would send two plans for one day', () => {
    expect(() =>
      buildPlanUpdates({
        student,
        dates: ['2026-08-17', '2026-08-17'],
        transportation: option(),
      }),
    ).toThrow(/listed more than once/);
  });
});

describe('option rules', () => {
  it('requires a note when the school marks the option note-required', () => {
    expect(() => normalizeNote(option({ IsNoteRequired: true }), '  ')).toThrow(/requires a note/);
  });

  it('carries the school’s own note hint as the error hint', () => {
    // The hint is what tells a caller what the school expects, and it lives on
    // McpToolError.hint rather than in the message — assert the field itself,
    // not a substring of the message it is not part of.
    try {
      normalizeNote(option({ IsNoteRequired: true, NoteHint: 'Who is collecting?' }), undefined);
      expect.unreachable('a note-required option with no note must throw');
    } catch (err) {
      expect((err as McpToolError).hint).toContain('Who is collecting?');
    }
  });

  it('falls back to generic guidance when the school gives no note hint', () => {
    try {
      normalizeNote(option({ IsNoteRequired: true }), undefined);
      expect.unreachable('a note-required option with no note must throw');
    } catch (err) {
      expect((err as McpToolError).hint).toMatch(/Pass note with the detail/);
    }
  });

  it('normalises a blank optional note to null', () => {
    expect(normalizeNote(option(), '   ')).toBeNull();
    expect(normalizeNote(option(), undefined)).toBeNull();
  });

  it('trims a note that is supplied', () => {
    expect(normalizeNote(option(), '  Chris Hall ')).toBe('Chris Hall');
  });

  it('requires a time for an early dismissal', () => {
    expect(() => normalizeEarlyDismissal(option({ IsEarlyDismissal: true }), undefined)).toThrow(
      /needs a time/,
    );
  });

  it('rejects a time that is not HH:MM', () => {
    expect(() => normalizeEarlyDismissal(option({ IsEarlyDismissal: true }), '1pm')).toThrow(
      /not an HH:MM time/,
    );
  });

  it('drops a time on an option that is not an early dismissal', () => {
    expect(normalizeEarlyDismissal(option(), '13:00')).toBeUndefined();
  });

  it('drops a car number on an option that does not use them', () => {
    expect(normalizeCarNumber(option(), '42')).toBeUndefined();
  });

  it('treats a missing car number on a car-number option as absent', () => {
    expect(normalizeCarNumber(option({ UseCarNumbers: true }), undefined)).toBeUndefined();
  });
});

describe('assertTransportationAllowed', () => {
  it('refuses a limited option the student has not been granted', () => {
    expect(() =>
      assertTransportationAllowed(student, option({ IsLimited: true, TransportationId: 999 })),
    ).toThrow(/restricted and not available/);
  });

  it('allows a limited option the student has been granted', () => {
    expect(() =>
      assertTransportationAllowed(
        { ...student, LimitedIds: [999] },
        option({ IsLimited: true, TransportationId: 999 }),
      ),
    ).not.toThrow();
  });

  it('treats a missing LimitedIds list as granting nothing', () => {
    expect(() =>
      assertTransportationAllowed(
        { ...student, LimitedIds: null },
        option({ IsLimited: true, TransportationId: 999 }),
      ),
    ).toThrow(/restricted/);
  });

  it('refuses any change for a student the school has locked', () => {
    expect(() => assertTransportationAllowed({ ...student, AllowPlans: false }, option())).toThrow(
      /not allowed to have plans changed/,
    );
  });

  it('names the student generically when the record has no first name', () => {
    expect(() =>
      assertTransportationAllowed({ ...student, AllowPlans: false, FirstName: null }, option()),
    ).toThrow(/This student is not allowed/);
  });
});

describe('applyDefaultPlans', () => {
  it('updates the weekday that already has a default', () => {
    const result = applyDefaultPlans({
      student,
      dayIds: [2],
      transportation: option({ TransportationId: 41245, Name: 'Bus' }),
      note: 'Route 7',
    });
    expect(result.DefaultPlans).toContainEqual({
      DayId: 2,
      TransportationId: 41245,
      TransportationName: 'Bus',
      Note: 'Route 7',
      EarlyDismissalTime: undefined,
    });
  });

  it('adds a weekday that had no default', () => {
    const result = applyDefaultPlans({ student, dayIds: [6], transportation: option() });
    expect(result.DefaultPlans?.find((p) => p.DayId === 6)?.TransportationId).toBe(41246);
  });

  it('leaves the weekdays it was not asked about untouched', () => {
    const result = applyDefaultPlans({ student, dayIds: [2], transportation: option() });
    expect(result.DefaultPlans?.find((p) => p.DayId === 3)).toEqual({
      DayId: 3,
      TransportationId: 41245,
      TransportationName: 'Bus',
      Note: null,
    });
  });

  it('does not mutate the student record it was given', () => {
    const before = JSON.stringify(student);
    applyDefaultPlans({ student, dayIds: [2], transportation: option({ Name: 'Bus' }) });
    expect(JSON.stringify(student)).toBe(before);
  });

  it('applies a repeated weekday only once', () => {
    const result = applyDefaultPlans({ student, dayIds: [6, 6], transportation: option() });
    expect(result.DefaultPlans?.filter((p) => p.DayId === 6)).toHaveLength(1);
  });

  it('carries every other student field through verbatim, since the whole record is PUT back', () => {
    const result = applyDefaultPlans({ student, dayIds: [2], transportation: option() });
    expect(result.StudentId).toBe(student.StudentId);
    expect(result.SchoolId).toBe(student.SchoolId);
    expect(result.LimitedIds).toEqual(student.LimitedIds);
  });

  it('starts from an empty list when the student has no defaults yet', () => {
    const result = applyDefaultPlans({
      student: { ...student, DefaultPlans: null },
      dayIds: [2],
      transportation: option(),
    });
    expect(result.DefaultPlans).toHaveLength(1);
  });

  it('rejects an empty weekday list', () => {
    expect(() => applyDefaultPlans({ student, dayIds: [], transportation: option() })).toThrow(
      /No weekdays given/,
    );
  });

  it.each([0, 8, 2.5])('rejects weekday id %s', (dayId) => {
    expect(() => applyDefaultPlans({ student, dayIds: [dayId], transportation: option() })).toThrow(
      /not a weekday id/,
    );
  });
});

describe('clearDefaultPlans', () => {
  it('empties the defaults without touching anything else', () => {
    const result = clearDefaultPlans(student);
    expect(result.DefaultPlans).toEqual([]);
    expect(result.StudentId).toBe(student.StudentId);
    expect(student.DefaultPlans).toHaveLength(2);
  });
});
