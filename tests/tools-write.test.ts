import { describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { expectedPlanState, normalizeTimeOfDay, proofsMatch } from '../src/tools/plans.js';
import { parseWeekdays } from '../src/tools/defaults.js';
import {
  BUS,
  EARLY,
  makeClient,
  makeClientWithStudentWrite,
  makeStudent,
  PICKUP,
  SCHOOL_ID,
  STUDENT_ID,
} from './helpers.js';

const MONDAY = '2026-08-17';

// A client that shows the confirmation prompt and the user accepts it: the
// gate passes in one call, so these tests exercise the write itself.
const ACCEPT = {
  elicitation: async () => ({ action: 'accept' as const, content: { confirmed: true } }),
};

describe('pup_set_plan confirmation preview', () => {
  it('sends nothing and previews the exact payload before confirmation', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
      }),
    );

    expect(result['status']).toBe('confirmation-required');
    const preview = result['preview'] as Record<string, unknown>;
    expect(preview['dto']).toBe('UpdatePlans');
    expect(preview['willSend']).toEqual({
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
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: 999,
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
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
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

  // The trap the live account exposed: every dismissal option at this school
  // requires a note, so changing only the note is an ordinary edit. Comparing
  // the transportation id alone would report success while observing nothing.
  it('catches a note-only change that did not land, though the option matches', async () => {
    const client = makeClient({
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: BUS.TransportationId,
        TransportationName: 'Bus',
        Note: 'the old note',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
        note: 'the new note',
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual([MONDAY]);
    await h.close();
  });

  it('passes when both the option and the note landed', async () => {
    const client = makeClient({
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: BUS.TransportationId,
        Note: 'the new note',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
        note: 'the new note',
      }),
    );
    expect(result['verified']).toBe(true);
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
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: BUS.TransportationId,
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual([MONDAY]);
    expect(result['warning']).toMatch(/school cutoff/);
    await h.close();
  });

  it('clears dates back to the default and verifies against that default', async () => {
    const client = makeClient({
      // A cleared date reads back as an empty override slot — GetPlanEdit does
      // not merge the weekday default into it.
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: null,
        TransportationName: null,
        Note: null,
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: null,
      }),
    );
    expect(client.updatePlans).toHaveBeenCalledWith([
      expect.objectContaining({ TransportationId: null, TransportationName: 'Default plan' }),
    ]);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('sends an early-dismissal time when the option needs one', async () => {
    const client = makeClient({
      getPlanEdit: vi
        .fn()
        .mockResolvedValue({ TransportationId: EARLY.TransportationId, EarlyDismissalTime: '13:00:00' }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: EARLY.TransportationId,
      early_dismissal_time: '13:00',
    });
    expect(client.updatePlans).toHaveBeenCalledWith([
      expect.objectContaining({ EarlyDismissalTime: '13:00:00' }),
    ]);
    await h.close();
  });
});

describe('pup_set_plan verification beyond option and note', () => {
  // The audit scenario: early dismissal already set for 14:30 with the same
  // note; the parent moves it to 13:00 and the service silently drops the
  // write. Option and note still match — only the time proves the change.
  it('catches an early-dismissal time that did not change', async () => {
    const client = makeClient({
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: EARLY.TransportationId,
        TransportationName: 'Early dismissal',
        Note: 'Mom picking up',
        EarlyDismissalTime: '14:30:00',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: EARLY.TransportationId,
        note: 'Mom picking up',
        early_dismissal_time: '13:00',
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual([MONDAY]);
    await h.close();
  });

  it('passes an early-dismissal change once the new time reads back', async () => {
    const client = makeClient({
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: EARLY.TransportationId,
        Note: 'Mom picking up',
        EarlyDismissalTime: '13:00:00',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: EARLY.TransportationId,
        note: 'Mom picking up',
        early_dismissal_time: '13:00',
      }),
    );
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('catches a car number that did not change', async () => {
    const CAR_LINE = {
      TransportationId: 41249,
      SchoolId: SCHOOL_ID,
      Name: 'Car line',
      IsActive: true,
      UseCarNumbers: true,
    };
    const client = makeClient({
      getTransportations: vi.fn().mockResolvedValue([CAR_LINE]),
      getPlanEdit: vi.fn().mockResolvedValue({
        TransportationId: CAR_LINE.TransportationId,
        Note: null,
        CarNumber: '12',
      }),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: [MONDAY],
        transportation_id: CAR_LINE.TransportationId,
        car_number: '47',
      }),
    );
    expect(result['verified']).toBe(false);
    await h.close();
  });
});

describe('normalizeTimeOfDay', () => {
  it.each([
    ['9:05', '09:05:00'],
    ['13:05:30', '13:05:30'],
    ['PT13H30M', '13:30:00'],
    ['PT45M', '00:45:00'],
    ['PT13H0M15.5S', '13:00:15'],
    ['2026-08-17T13:05:00Z', '13:05:00'],
  ])('reads %j as %j', (input, output) => {
    expect(normalizeTimeOfDay(input)).toBe(output);
  });

  // Unrecognised shapes stay as they are, so they can only compare unequal:
  // a false "unchanged" is recoverable, a false "verified" is not.
  it.each(['PT', 'soon', ''])('leaves %j as it is', (input) => {
    expect(normalizeTimeOfDay(` ${input} `)).toBe(input);
  });
});

describe('expectedPlanState', () => {
  it('expects what was asked for on a normal change', () => {
    expect(expectedPlanState({ transportationId: 41245, note: 'hi' })).toEqual({
      transportationId: 41245,
      note: 'hi',
    });
  });

  // GetPlanEdit reports the date's OVERRIDE, not the effective plan — verified
  // live on a Friday where the student had a Friday default and the date still
  // read back null. Expecting the default would fail every good revert.
  it('expects an empty slot after a revert, not the weekday default', () => {
    expect(expectedPlanState({ transportationId: null, note: 'ignored' })).toEqual({
      transportationId: null,
      note: null,
    });
  });
});

describe('proofsMatch', () => {
  it('ignores whitespace the service may normalise off a note', () => {
    expect(proofsMatch({ transportationId: 1, note: ' a ' }, { transportationId: 1, note: 'a' })).toBe(true);
  });

  it('treats a null note and an empty note as the same', () => {
    expect(proofsMatch({ transportationId: 1, note: null }, { transportationId: 1, note: '' })).toBe(true);
  });

  it('sees a different note as a mismatch', () => {
    expect(proofsMatch({ transportationId: 1, note: 'a' }, { transportationId: 1, note: 'b' })).toBe(false);
  });

  it('sees a different early-dismissal time as a mismatch', () => {
    expect(
      proofsMatch(
        { transportationId: 1, note: 'a', earlyDismissalTime: '14:30:00' },
        { transportationId: 1, note: 'a', earlyDismissalTime: '13:00:00' },
      ),
    ).toBe(false);
  });

  it.each(['13:00', '13:00:00', ' 13:00:00 ', 'PT13H', 'PT13H0M', '1900-01-01T13:00:00'])(
    'normalises a read-back time of %j before comparing',
    (readBack) => {
      expect(
        proofsMatch(
          { transportationId: 1, note: null, earlyDismissalTime: readBack },
          { transportationId: 1, note: null, earlyDismissalTime: '13:00:00' },
        ),
      ).toBe(true);
    },
  );

  it('sees a missing read-back time as a mismatch when one was sent', () => {
    expect(
      proofsMatch(
        { transportationId: 1, note: null, earlyDismissalTime: null },
        { transportationId: 1, note: null, earlyDismissalTime: '13:00:00' },
      ),
    ).toBe(false);
  });

  it('sees a different car number as a mismatch, ignoring whitespace', () => {
    const expected = { transportationId: 1, note: null, carNumber: '47' };
    expect(proofsMatch({ transportationId: 1, note: null, carNumber: ' 47 ' }, expected)).toBe(true);
    expect(proofsMatch({ transportationId: 1, note: null, carNumber: '12' }, expected)).toBe(false);
    expect(proofsMatch({ transportationId: 1, note: null, carNumber: null }, expected)).toBe(false);
  });

  it('expects an empty time when the expected time is null', () => {
    const expected = { transportationId: 1, note: null, earlyDismissalTime: null };
    expect(proofsMatch({ transportationId: 1, note: null, earlyDismissalTime: null }, expected)).toBe(true);
    expect(proofsMatch({ transportationId: 1, note: null, earlyDismissalTime: '13:00:00' }, expected)).toBe(false);
  });

  it('expects no car number when the expected car number is null', () => {
    const expected = { transportationId: 1, note: null, carNumber: null };
    expect(proofsMatch({ transportationId: 1, note: null, carNumber: '' }, expected)).toBe(true);
    expect(proofsMatch({ transportationId: 1, note: null, carNumber: '12' }, expected)).toBe(false);
  });

  it('ignores time and car number when the write did not send them', () => {
    expect(
      proofsMatch(
        { transportationId: 1, note: null, earlyDismissalTime: '14:30:00', carNumber: '12' },
        { transportationId: 1, note: null },
      ),
    ).toBe(true);
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
    expect(result['status']).toBe('confirmation-required');
    expect((result['preview'] as Record<string, unknown>)['dto']).toBe('Student');
    expect(client.updateStudent).not.toHaveBeenCalled();
    await h.close();
  });

  it('sends the whole student record back with only DefaultPlans changed', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({
        DefaultPlans: [
          { DayId: 2, TransportationId: PICKUP.TransportationId },
          { DayId: 3, TransportationId: BUS.TransportationId, TransportationName: 'Bus' },
        ],
      }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Tuesday'],
        transportation_id: BUS.TransportationId,
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

  it('catches a default whose note did not change, though the option matches', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({
        DefaultPlans: [
          { DayId: 2, TransportationId: PICKUP.TransportationId, Note: 'the old note' },
        ],
      }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Monday'],
        transportation_id: PICKUP.TransportationId,
        note: 'the new note',
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual(['Monday']);
    await h.close();
  });

  it('catches a default whose early-dismissal time did not change', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({
        DefaultPlans: [
          {
            DayId: 2,
            TransportationId: EARLY.TransportationId,
            Note: null,
            EarlyDismissalTime: '14:30:00',
          },
        ],
      }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Monday'],
        transportation_id: EARLY.TransportationId,
        early_dismissal_time: '13:00',
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual(['Monday']);
    await h.close();
  });

  it('passes a default change when the option and the note both landed', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({
        DefaultPlans: [
          { DayId: 2, TransportationId: PICKUP.TransportationId, Note: 'the new note' },
        ],
      }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Monday'],
        transportation_id: PICKUP.TransportationId,
        note: 'the new note',
      }),
    );
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('treats a weekday that came back with no option at all as unchanged', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({ DefaultPlans: [{ DayId: 2 }] }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Monday'],
        transportation_id: PICKUP.TransportationId,
        note: 'a note',
      }),
    );
    expect(result['verified']).toBe(false);
    await h.close();
  });

  it('reports the weekdays that did not take', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Saturday'],
        transportation_id: BUS.TransportationId,
      }),
    );
    expect(result['verified']).toBe(false);
    expect(result['unchanged']).toEqual(['Saturday']);
    await h.close();
  });

  it('clears every default and verifies the list is empty', async () => {
    const client = makeClientWithStudentWrite(
      makeStudent(),
      makeStudent({ DefaultPlans: [] }),
    );
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        clear_all: true,
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
    expect(result['status']).toBe('confirmation-required');
    expect(client.updateStudent).not.toHaveBeenCalled();
    await h.close();
  });

  it('warns when a clear-all left defaults behind', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        clear_all: true,
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
    expect(result['status']).toBe('confirmation-required');
    expect(client.setDefaultsReviewed).not.toHaveBeenCalled();
    await h.close();
  });

  it('marks reviewed and verifies the prompt cleared', async () => {
    const client = makeClient({
      getDefaultPlansReviewNeeded: vi
        .fn()
        .mockResolvedValue([{ StudentId: STUDENT_ID, NeedsReview: false }]),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID }),
    );
    expect(client.setDefaultsReviewed).toHaveBeenCalledWith(STUDENT_ID, true);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('can set the flag back on, and verifies that too', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', {
        student_id: STUDENT_ID,
        reviewed: false,
      }),
    );
    expect(client.setDefaultsReviewed).toHaveBeenCalledWith(STUDENT_ID, false);
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('reports an unverified result when the flag did not move', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID }),
    );
    expect(result['verified']).toBe(false);
    await h.close();
  });

  it('treats a student missing from the review list as not needing review', async () => {
    const client = makeClient({ getDefaultPlansReviewNeeded: vi.fn().mockResolvedValue([]) });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client), ACCEPT);
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID }),
    );
    expect(result['needsDefaultsReview']).toBe(false);
    await h.close();
  });
});
