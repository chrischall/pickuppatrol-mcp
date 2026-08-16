import { describe, expect, it } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerAccountTools } from '../src/tools/account.js';
import { registerSchoolTools } from '../src/tools/school.js';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { makeClient, makeStudent, SCHOOL_ID, STUDENT_ID } from './helpers.js';

describe('pup_get_session', () => {
  it('reports the account and its students', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_get_session'));
    expect(result).toMatchObject({
      userId: 42,
      name: 'Chris Hall',
      email: 'parent@example.com',
      children: [{ StudentId: STUDENT_ID, SchoolId: SCHOOL_ID }],
    });
    await h.close();
  });

  it('falls back to first + last name when the API sends no display name', async () => {
    const client = makeClient({
      getSession: (await import('vitest')).vi.fn().mockResolvedValue({
        FirstName: 'Chris',
        LastName: 'Hall',
        PrimaryEmail: 'p@example.com',
      }),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_get_session'));
    expect(result['name']).toBe('Chris Hall');
    expect(result['email']).toBe('p@example.com');
    expect(result['children']).toEqual([]);
    await h.close();
  });
});

describe('pup_list_students', () => {
  it('summarises each student and folds in the review flag', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    );
    expect(result[0]).toMatchObject({
      studentId: STUDENT_ID,
      firstName: 'Lucas',
      schoolName: 'Whitewater Center',
      needsDefaultsReview: true,
    });
    expect(result[0]?.['defaultPlans']).toEqual([
      {
        dayId: 2,
        weekday: 'Monday',
        transportationId: 41246,
        transportation: 'PickUp',
        note: 'Chris Hall',
        earlyDismissalTime: null,
        carNumber: null,
      },
    ]);
    await h.close();
  });

  it('defaults the review flag to false for a student the API omits', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({ getDefaultPlansReviewNeeded: vi.fn().mockResolvedValue([]) });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    );
    expect(result[0]?.['needsDefaultsReview']).toBe(false);
    await h.close();
  });

  it('orders the weekly defaults Sunday first and labels a day the API did not name', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({
      getChildren: vi.fn().mockResolvedValue([
        makeStudent({
          DefaultPlans: [
            { DayId: 6, TransportationId: 1, TransportationName: 'Bus' },
            { DayId: 1, TransportationId: 2, TransportationName: 'Walker' },
          ],
        }),
      ]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    );
    const plans = result[0]?.['defaultPlans'] as Array<Record<string, unknown>>;
    expect(plans.map((p) => p['weekday'])).toEqual(['Sunday', 'Friday']);
    await h.close();
  });

  it('hides a car number for an option that does not use them', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({
      getChildren: vi.fn().mockResolvedValue([
        makeStudent({
          DefaultPlans: [
            { DayId: 2, TransportationId: 1, CarNumber: '12', UseCarNumbers: false },
            { DayId: 3, TransportationId: 1, CarNumber: '12', UseCarNumbers: true },
          ],
        }),
      ]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const plans = (
      parseToolResult<Array<Record<string, unknown>>>(await h.callTool('pup_list_students'))[0]?.[
        'defaultPlans'
      ] as Array<Record<string, unknown>>
    ).map((p) => p['carNumber']);
    expect(plans).toEqual([null, '12']);
    await h.close();
  });

  it('handles a student with no defaults at all', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({
      getChildren: vi.fn().mockResolvedValue([makeStudent({ DefaultPlans: null })]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    );
    expect(result[0]?.['defaultPlans']).toEqual([]);
    await h.close();
  });
});

describe('pup_get_student', () => {
  it('returns the summary by default and the raw record on request', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerAccountTools(s, client));

    const summary = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_student', { student_id: STUDENT_ID }),
    );
    expect(summary).toHaveProperty('studentId');
    expect(summary).not.toHaveProperty('StudentId');

    const raw = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_student', { student_id: STUDENT_ID, raw: true }),
    );
    expect(raw).toHaveProperty('StudentId');
    await h.close();
  });
});

describe('pup_healthcheck', () => {
  it('reports ok with the account it signed in as', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_healthcheck'));
    expect(result).toMatchObject({ ok: true, signedInAs: 'parent@example.com', studentCount: 1 });
    await h.close();
  });

  // The point of a healthcheck is to say what is wrong; throwing would read to
  // the host as the tool itself being broken.
  it('reports the failure instead of throwing', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({
      getSession: vi.fn().mockRejectedValue(new Error('PICKUPPATROL_PASSWORD is required')),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_healthcheck'));
    expect(result['ok']).toBe(false);
    expect(result['error']).toMatch(/PICKUPPATROL_PASSWORD/);
    await h.close();
  });

  it('falls back to the display name when the account has no email', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({
      getSession: vi.fn().mockResolvedValue({ DisplayName: 'Chris Hall' }),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_healthcheck'));
    expect(result).toMatchObject({ ok: true, signedInAs: 'Chris Hall', studentCount: 0 });
    await h.close();
  });
});

describe('school tools', () => {
  it('lists active dismissal options with the rules each imposes', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_transportations', { school_id: SCHOOL_ID }),
    );
    expect(result.map((o) => o['name'])).toEqual(['PickUp', 'Bus', 'Early dismissal']);
    expect(result[0]).toMatchObject({
      transportationId: 41246,
      noteRequired: true,
      noteHint: 'Who is collecting?',
      usesCarNumbers: false,
      isEarlyDismissal: false,
    });
    await h.close();
  });

  it('includes deactivated options on request', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_transportations', {
        school_id: SCHOOL_ID,
        include_inactive: true,
      }),
    );
    expect(result).toHaveLength(4);
    await h.close();
  });

  it('returns the school with its notify times and settings together', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_school', { school_id: SCHOOL_ID }),
    );
    expect(result).toHaveProperty('school');
    expect(result).toHaveProperty('notifyTimes');
    expect(result).toHaveProperty('settings');
    await h.close();
  });

  it('returns non-school days alone, or with changed dates when a range is given', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));

    const bare = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_list_non_school_days', { school_id: SCHOOL_ID }),
    );
    expect(bare).toEqual({ invalidDates: ['2026-08-15'] });

    const ranged = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_list_non_school_days', {
        school_id: SCHOOL_ID,
        start_date: '2026-08-01',
        end_date: '2026-08-31',
      }),
    );
    expect(ranged).toEqual({ invalidDates: ['2026-08-15'], changedDates: ['2026-08-17'] });
    await h.close();
  });

  it('needs both ends of the range before it reports changed dates', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_list_non_school_days', {
        school_id: SCHOOL_ID,
        start_date: '2026-08-01',
      }),
    );
    expect(result).not.toHaveProperty('changedDates');
    await h.close();
  });

  it('lists the account car numbers', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    expect(
      parseToolResult(await h.callTool('pup_list_car_numbers', { school_id: SCHOOL_ID })),
    ).toEqual(['12']);
    await h.close();
  });
});

describe('plan reads', () => {
  it('passes the range through to GetParentPlans', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    await h.callTool('pup_list_plans', { start_date: '2026-08-01', end_date: '2026-08-31' });
    expect(client.getParentPlans).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    await h.close();
  });

  it('returns one date for one student', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_plan', { student_id: STUDENT_ID, date: '2026-08-17' }),
    );
    expect(result['TransportationName']).toBe('Bus');
    await h.close();
  });
});

describe('pup_get_default_plans', () => {
  it('reports the weekly defaults and the review flag', async () => {
    const client = makeClient();
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_default_plans', { student_id: STUDENT_ID }),
    );
    expect(result).toMatchObject({
      studentId: STUDENT_ID,
      name: 'Lucas Hall',
      needsDefaultsReview: true,
    });
    expect(result['defaultPlans']).toHaveLength(1);
    await h.close();
  });

  it('defaults the review flag to false when the student is absent from the list', async () => {
    const { vi } = await import('vitest');
    const client = makeClient({ getDefaultPlansReviewNeeded: vi.fn().mockResolvedValue([]) });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_default_plans', { student_id: STUDENT_ID }),
    );
    expect(result['needsDefaultsReview']).toBe(false);
    await h.close();
  });
});
