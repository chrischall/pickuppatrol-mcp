import { describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { PickUpPatrolAuth } from '../src/auth.js';
import { PickUpPatrolClient } from '../src/client.js';
import { previewUnlessConfirmed } from '../src/tools/_confirm.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerSchoolTools } from '../src/tools/school.js';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { makeClient, makeStudent, BUS, SCHOOL_ID, STUDENT_ID } from './helpers.js';

describe('previewUnlessConfirmed', () => {
  it('omits willSend when there is no body to show', () => {
    const result = previewUnlessConfirmed(undefined, 'Do a thing', 'PUT', 'AcceptTerms');
    const body = JSON.parse((result?.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(body).not.toHaveProperty('willSend');
    expect(body['dryRun']).toBe(true);
  });

  it('returns null once confirmed, so the caller proceeds', () => {
    expect(previewUnlessConfirmed(true, 'Do a thing', 'PUT', 'AcceptTerms')).toBeNull();
  });
});

// The default `fetchImpl` is the real global fetch. Exercising it against a
// stubbed global proves the wiring without opening a socket.
describe('default fetch wiring', () => {
  it('auth falls back to the global fetch', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ BearerToken: 'jwt' })));
    const auth = new PickUpPatrolAuth({ username: 'u', password: 'p' });
    await expect(auth.ensure()).resolves.toMatchObject({ bearerToken: 'jwt' });
    expect(globalFetch).toHaveBeenCalledOnce();
    globalFetch.mockRestore();
  });

  it('the client falls back to the global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    const auth = new PickUpPatrolAuth({ username: 'u', password: 'p', fetchImpl: vi.fn() });
    vi.spyOn(auth, 'ensure').mockResolvedValue({
      bearerToken: 'jwt',
      refreshToken: null,
      cookieHeader: '',
    });
    await expect(new PickUpPatrolClient({ auth }).getChildren()).resolves.toEqual([]);
    expect(globalFetch).toHaveBeenCalledOnce();
    globalFetch.mockRestore();
  });
});

describe('missing-field fallbacks', () => {
  it('reports a null email when the account carries neither address', async () => {
    const client = makeClient({ getSession: vi.fn().mockResolvedValue({ DisplayName: 'Chris' }) });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const session = parseToolResult<Record<string, unknown>>(await h.callTool('pup_get_session'));
    expect(session).toMatchObject({
      userId: null,
      email: null,
      lastLoginDate: null,
      sendPlanConfirmEmails: null,
      hasAcceptedLatestTerms: null,
    });
    await h.close();
  });

  it('reports a null identity when the healthcheck session names nobody', async () => {
    const client = makeClient({ getSession: vi.fn().mockResolvedValue({}) });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(await h.callTool('pup_healthcheck'));
    expect(result).toMatchObject({ ok: true, signedInAs: null, studentCount: 0 });
    await h.close();
  });

  it('reports a null car number for a car-number day that has none set', async () => {
    const client = makeClient({
      getChildren: vi
        .fn()
        .mockResolvedValue([makeStudent({ DefaultPlans: [{ DayId: 2, UseCarNumbers: true }] })]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const plans = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    )[0]?.['defaultPlans'] as Array<Record<string, unknown>>;
    expect(plans[0]?.['carNumber']).toBeNull();
    await h.close();
  });

  it('summarises a student the API returned almost empty', async () => {
    const client = makeClient({
      getChildren: vi.fn().mockResolvedValue([{ StudentId: 1, SchoolId: 2 }]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    );
    expect(result[0]).toMatchObject({
      studentId: 1,
      allowPlans: null,
      defaultCarNumber: null,
      defaultsReviewedDate: null,
      defaultPlans: [],
    });
    await h.close();
  });

  it('reports an unnamed weekday default as null rather than guessing', async () => {
    const client = makeClient({
      getChildren: vi.fn().mockResolvedValue([
        makeStudent({ DefaultPlans: [{ DayId: 9 }] }),
      ]),
    });
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    const plans = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_students'),
    )[0]?.['defaultPlans'] as Array<Record<string, unknown>>;
    expect(plans[0]).toMatchObject({
      weekday: null,
      transportationId: null,
      transportation: null,
      note: null,
      earlyDismissalTime: null,
    });
    await h.close();
  });

  it('lists a transportation the API described only minimally', async () => {
    const client = makeClient({
      getTransportations: vi
        .fn()
        .mockResolvedValue([{ TransportationId: 1, SchoolId: SCHOOL_ID, Name: 'Walker' }]),
    });
    const h = await createTestHarness((s) => registerSchoolTools(s, client));
    const result = parseToolResult<Array<Record<string, unknown>>>(
      await h.callTool('pup_list_transportations', { school_id: SCHOOL_ID }),
    );
    expect(result[0]).toEqual({
      transportationId: 1,
      name: 'Walker',
      noteRequired: false,
      noteHint: null,
      usesCarNumbers: false,
      isEarlyDismissal: false,
      isLimited: false,
      cutoffTime: null,
      active: true,
    });
    await h.close();
  });

  it('names the student generically in the action when the record has no first name', async () => {
    const client = makeClient({
      getStudent: vi.fn().mockResolvedValue(makeStudent({ FirstName: null })),
    });
    const h = await createTestHarness((s) => registerPlanTools(s, client));

    const change = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: ['2026-08-17'],
        transportation_id: BUS.TransportationId,
      }),
    );
    expect(change['action']).toMatch(/^Set 1 date\(s\) for the student to "Bus"$/);

    const revert = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: ['2026-08-17'],
        transportation_id: null,
      }),
    );
    expect(revert['action']).toMatch(/^Clear 1 date\(s\) back to the student's default plan$/);
    await h.close();
  });

  it('names the student generically in the default-plan actions too', async () => {
    const client = makeClient({
      getStudent: vi.fn().mockResolvedValue(makeStudent({ FirstName: null })),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));

    const set = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        days: ['Tuesday'],
        transportation_id: BUS.TransportationId,
      }),
    );
    expect(set['action']).toMatch(/^Set the student's default plan on Tuesday/);

    const cleared = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', { student_id: STUDENT_ID, clear_all: true }),
    );
    expect(cleared['action']).toMatch(/^Clear every weekday default for the student$/);
    await h.close();
  });

  it('reports a plan read whose fields are all absent', async () => {
    const client = makeClient({ getPlanEdit: vi.fn().mockResolvedValue({}) });
    const h = await createTestHarness((s) => registerPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_plan', {
        student_id: STUDENT_ID,
        dates: ['2026-08-18'],
        transportation_id: BUS.TransportationId,
        confirm: true,
      }),
    );
    const applied = (result['applied'] as Array<Record<string, unknown>>)[0];
    expect(applied).toMatchObject({
      transportationId: null,
      transportation: null,
      note: null,
      earlyDismissalTime: null,
      locked: false,
      verified: false,
    });
    await h.close();
  });

  it('reports a student with no defaults after a change', async () => {
    const client = makeClient({
      getStudent: vi
        .fn()
        .mockResolvedValueOnce(makeStudent())
        .mockResolvedValueOnce(makeStudent({ DefaultPlans: null })),
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
    expect(result['verified']).toBe(false);
    await h.close();
  });

  it('reports a clear-all whose re-read returned no defaults field at all', async () => {
    const client = makeClient({
      getStudent: vi
        .fn()
        .mockResolvedValueOnce(makeStudent())
        .mockResolvedValueOnce(makeStudent({ DefaultPlans: null })),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_set_default_plans', {
        student_id: STUDENT_ID,
        clear_all: true,
        confirm: true,
      }),
    );
    expect(result['verified']).toBe(true);
    await h.close();
  });

  it('summarises a student whose default plans field is missing entirely', async () => {
    const client = makeClient({
      getStudent: vi.fn().mockResolvedValue({ StudentId: 1, SchoolId: 2 }),
    });
    const h = await createTestHarness((s) => registerDefaultPlanTools(s, client));
    const result = parseToolResult<Record<string, unknown>>(
      await h.callTool('pup_get_default_plans', { student_id: 1 }),
    );
    expect(result).toMatchObject({ name: '', allowPlans: null, defaultsReviewedDate: null });
    await h.close();
  });
});
