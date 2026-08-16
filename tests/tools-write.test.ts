import { describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { expectedTransportationId } from '../src/tools/plans.js';
import { parseWeekdays } from '../src/tools/defaults.js';
import { BUS, EARLY, makeClient, makeStudent, PICKUP, SCHOOL_ID, STUDENT_ID } from './helpers.js';

const MONDAY = '2026-08-17';

describe('pup_set_plan confirm gate', () => {
  it('sends nothing and previews the exact payload without confirm', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
      }),
    );

    expect(result['dryRun']).toBe(true);
    expect(result['dto']).toBe('UpdatePlans');
    expect(result['willSend']).toEqual({
      Plans: [
        {
          StudentId: STUDENT_ID,
          SchoolId: SCHOOL_ID,
          PlanDate: MONDAY,
          TransportationId: BUS.TransportationId,
          TransportationName: 'Bus',
          Note: null,
        },
      ],
    });
    expect(client.updatePlans).not.toHaveBeenCalled();
    await h.close();
  });

  it('validates against the school rules before it will even preview', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    // PickUp requires a note; the preview must refuse rather than show a
    // payload the server would reject.
    const result = await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: PICKUP.TransportationId,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/requires a note/);
    expect(client.updatePlans).not.toHaveBeenCalled();
    await h.close();
  });

  it('rejects an option that is not on the school list, naming the options', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: 999,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/No dismissal option 999/);
    expect(JSON.stringify(result.content)).toMatch(/41245 \(Bus\)/);
    expect(client.updatePlans).not.toHaveBeenCalled();
    await h.close();
  });
});

describe('pup_set_plan write', () => {
  it('writes and then re-reads each date to prove the change landed', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
        confirm: true,
      }),
    );

    expect(client.updatePlans).toHaveBeenCalledTimes(1);
    expect(result['verified']).toBe(true);
    expect(result['applied']).toEqual([
      {
        date: MONDAY,
        weekday: 'Monday',
        transportationId: BUS.TransportationId,
        transportation: 'Bus',
        note: null,
        earlyDismissalTime: null,
        locked: false,
        verified: true,
      },
    ]);
    await h.close();
  });

  // The false-green trap: a write that the school silently ignored (past the
  // cutoff) still returns 2xx. Only the re-read catches it.
  it('reports the dates that did not actually change', async () => {
    const client = makeClient({
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: PICKUP.TransportationId,
        TransportationName: 'PickUp',
        IsLocked: true,
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
        confirm: true,
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual([MONDAY]);
    expect(result['warning']).toMatch(/school cutoff/);
    await h.close();
  });

  it('clears dates back to the default and verifies against that default', async () => {
    const client = makeClient({
      // After a revert, the date shows the student's Monday default (PickUp).
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: PICKUP.TransportationId,
        TransportationName: 'PickUp',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: null,
        confirm: true,
      }),
    );
    expect(client.updatePlans).toHaveBeenCalledWith([
      expect.objectContaining({ TransportationId: null, TransportationName: 'Default plan' }),
    ]);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  // Reverting a weekday the student has no default for leaves nothing to
  // assert against. Reporting null says so, rather than claiming a pass off a
  // comparison that was never made.
  it('reports verification as unknown when there is no default to fall back to', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        // A Tuesday; the fixture student only has a Monday default.
        dates: ['2026-08-18'],
        transportation_id: null,
        confirm: true,
      }),
    );
    const applied = (result['applied'] as Array<Record<string, unknown>>)[0];
    expect(applied?.['verified']).toBeNull();
    // An unknown is not a failure, so it must not be reported as one.
    expect(result['verified']).toBe(true);
    expect(result).not.toHaveProperty('unchanged');
    await h.close();
  });

  it('sends an early-dismissal time when the option needs one', async () => {
    const client = makeClient({
      getPlanEdit: vi
        .fn()
        .mockResolvedValue({ TransportationId: EARLY.TransportationId, EarlyDismissalTime: '13:00:00' }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: EARLY.TransportationId,
      early_dismissal_time: '13:00',
      confirm: true,
    });
    expect(client.updatePlans).toHaveBeenCalledWith([
      expect.objectContaining({ EarlyDismissalTime: '13:00:00' }),
    ]);
    await h.close();
  });
});

describe('expectedTransportationId', () => {
  const student = makeStudent();

  it('expects the id that was asked for on a normal change', () => {
    expect(expectedTransportationId(student, MONDAY, 41245)).toBe(41245);
  });

  it("expects the student's weekday default after a revert", () => {
    expect(expectedTransportationId(student, MONDAY, null)).toBe(PICKUP.TransportationId);
  });

  // Nothing to assert is reported as nothing, never as a pass — a proof field
  // that does not exist would otherwise compare equal to itself.
  it('asserts nothing when the student has no default for that weekday', () => {
    expect(expectedTransportationId(student, '2026-08-18', null)).toBeUndefined();
  });

  it('asserts nothing for an unparseable date', () => {
    expect(expectedTransportationId(student, 'not-a-date', null)).toBeUndefined();
  });

  it('treats a default with a null option as a null expectation', () => {
    const cleared = makeStudent({ DefaultPlans: [{ DayId: 2, TransportationId: null }] });
    expect(expectedTransportationId(cleared, MONDAY, null)).toBeNull();
  });

  it('handles a student with no defaults at all', () => {
    expect(expectedTransportationId(makeStudent({ DefaultPlans: null }), MONDAY, null)).toBeUndefined();
  });
});

describe('pup_set_default_plans', () => {
  it('previews the changed defaults without writing', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Tuesday'],
        transportation_id: BUS.TransportationId,
      }),
    );
    expect(result['dryRun']).toBe(true);
    expect(result['dto']).toBe('Student');
    expect(client.updateStudent).not.toHaveBeenCalled();
    await h.close();
  });

  it('sends the whole student record back with only DefaultPlans changed', async () => {
    const client = makeClient({
      getStudent: vi
        .fn()
        .mockResolvedValueOnce(makeStudent())
        .mockResolvedValueOnce(
          makeStudent({
            DefaultPlans: [
              { DayId: 2, TransportationId: PICKUP.TransportationId },
              { DayId: 3, TransportationId: BUS.TransportationId, TransportationName: 'Bus' },
            ],
          }),
        ),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Tuesday'],
        transportation_id: BUS.TransportationId,
        confirm: true,
      }),
    );

    const sent = (client.updateStudent as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(sent['StudentId']).toBe(STUDENT_ID);
    expect(sent['SchoolName']).toBe('Whitewater Center');
    expect(sent['DefaultPlans']).toHaveLength(2);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('reports the weekdays that did not take', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Saturday'],
        transportation_id: BUS.TransportationId,
        confirm: true,
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual(['Saturday']);
    await h.close();
  });

  it('clears every default and verifies the list is empty', async () => {
    const client = makeClient({
      getStudent: vi
        .fn()
        .mockResolvedValueOnce(makeStudent())
        .mockResolvedValueOnce(makeStudent({ DefaultPlans: [] })),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        clear_all: true,
        confirm: true,
      }),
    );
    expect(client.updateStudent).toHaveBeenCalledWith(
      expect.objectContaining({ DefaultPlans: [] }),
    );
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('previews a clear-all without writing', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', { student_id: STUDENT_ID, clear_all: true }),
    );
    expect(result['dryRun']).toBe(true);
    expect(client.updateStudent).not.toHaveBeenCalled();
    await h.close();
  });

  it('warns when a clear-all left defaults behind', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        clear_all: true,
        confirm: true,
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['warning']).toMatch(/still set/);
    await h.close();
  });

  it('requires days and an option unless clearing', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = await h.callTool('pup_set_default_plans', { student_id: STUDENT_ID });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/days and transportation_id are both required/);
    await h.close();
  });
});

describe('parseWeekdays', () => {
  it('accepts names, numeric ids and numeric strings', () => {
    expect(parseWeekdays(['Monday', 3, '4'])).toEqual([2, 3, 4]);
  });

  it.each([0, 8, 1.5])('rejects the out-of-range id %s', (day) => {
    expect(() => parseWeekdays([day])).toThrow(/not a weekday id/);
  });

  it('rejects a word that is not a weekday rather than landing on Sunday', () => {
    expect(() => parseWeekdays(['Someday'])).toThrow(/not a weekday/);
  });
});

describe('pup_mark_defaults_reviewed', () => {
  it('previews without writing', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID }),
    );
    expect(result['dryRun']).toBe(true);
    expect(client.setDefaultsReviewed).not.toHaveBeenCalled();
    await h.close();
  });

  it('marks reviewed and verifies the prompt cleared', async () => {
    const client = makeClient({
      getDefaultPlansReviewNeeded: vi
        .fn()
        .mockResolvedValue([{ StudentId: STUDENT_ID, NeedsReview: false }]),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID, confirm: true }),
    );
    expect(client.setDefaultsReviewed).toHaveBeenCalledWith(STUDENT_ID, true);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('can set the flag back on, and verifies that too', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', {
        student_id: STUDENT_ID,
        reviewed: false,
        confirm: true,
      }),
    );
    expect(client.setDefaultsReviewed).toHaveBeenCalledWith(STUDENT_ID, false);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('reports an unverified result when the flag did not move', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID, confirm: true }),
    );
    expect(result['verified']).toBe(false);
    await h.close();
  });

  it('treats a student missing from the review list as not needing review', async () => {
    const client = makeClient({ getDefaultPlansReviewNeeded: vi.fn().mockResolvedValue([]) });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID, confirm: true }),
    );
    expect(result['needsDefaultsReview']).toBe(false);
    await h.close();
  });
});
