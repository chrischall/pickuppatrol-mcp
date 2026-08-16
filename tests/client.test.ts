import { describe, expect, it, vi } from 'vitest';
import type { McpToolError } from '@chrischall/mcp-utils';
import { PickUpPatrolAuth } from '../src/auth.js';
import { PickUpPatrolClient } from '../src/client.js';

/** An auth that is already signed in, so tests exercise the client alone. */
function stubAuth(overrides: Partial<{ bearerToken: string | null; cookieHeader: string }> = {}) {
  const auth = new PickUpPatrolAuth({ username: 'u', password: 'p', fetchImpl: vi.fn() });
  // `??` would swallow an explicit null, which is exactly the cookie-only case
  // these tests exist to cover — so check for the key instead.
  vi.spyOn(auth, 'ensure').mockResolvedValue({
    bearerToken: 'bearerToken' in overrides ? (overrides.bearerToken ?? null) : 'jwt-abc',
    refreshToken: null,
    cookieHeader: 'cookieHeader' in overrides ? (overrides.cookieHeader ?? '') : 'ss-id=abc',
  });
  return auth;
}

function client(fetchImpl: ReturnType<typeof vi.fn>, authOverrides = {}) {
  return new PickUpPatrolClient({ auth: stubAuth(authOverrides), fetchImpl });
}

describe('request shape', () => {
  it('puts GET args on the query string of the DTO url', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('[]'));
    await client(fetchImpl).getPlanEdit('2026-08-17', 1050046);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://app.pickuppatrol.net/api/json/reply/GetPlanEdit?PlanDate=2026-08-17&StudentId=1050046',
    );
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('puts write args in the JSON body, not the query string', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(''));
    await client(fetchImpl).setDefaultsReviewed(1050046, true);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.pickuppatrol.net/api/json/reply/SetDefaultsReviewed');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ StudentId: 1050046, Reviewed: true });
  });

  it('wraps the plan array in the Plans envelope the API expects', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(''));
    const plans = [
      {
        StudentId: 1,
        SchoolId: 2,
        PlanDate: '2026-08-17',
        TransportationId: 3,
        TransportationName: 'Bus',
        Note: null,
      },
    ];
    await client(fetchImpl).updatePlans(plans);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ Plans: plans });
  });

  it('PUTs the whole student record to the Student DTO for default plans', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(''));
    const student = { StudentId: 1, SchoolId: 2, DefaultPlans: [] };
    await client(fetchImpl).updateStudent(student);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.pickuppatrol.net/api/json/reply/Student');
    expect(JSON.parse(init.body as string)).toEqual(student);
  });

  it('sends the bearer token and the session cookies together', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}'));
    await client(fetchImpl).getSession();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
    expect(headers['Cookie']).toBe('ss-id=abc');
  });

  it('omits Authorization when the deployment is cookie-only', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}'));
    await client(fetchImpl, { bearerToken: null }).getSession();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('omits Cookie when there are no session cookies', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}'));
    await client(fetchImpl, { cookieHeader: '' }).getSession();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('Cookie');
  });
});

describe('response handling', () => {
  it('parses a JSON body', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify([{ StudentId: 1 }])));
    await expect(client(fetchImpl).getChildren()).resolves.toEqual([{ StudentId: 1 }]);
  });

  // UpdatePlans and SetDefaultsReviewed declare no response type and answer
  // with an empty body — parsing that as JSON would throw on every write.
  it('treats an empty body as success, which is how the write DTOs answer', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(''));
    await expect(client(fetchImpl).setDefaultsReviewed(1, true)).resolves.toBeUndefined();
  });

  it('surfaces the ServiceStack error message on a failure', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ResponseStatus: { ErrorCode: 'PLAN-LOCKED', Message: 'The cutoff time has passed' },
          }),
          { status: 400 },
        ),
    );
    await expect(client(fetchImpl).getChildren()).rejects.toThrow(
      /GetChildren failed \(HTTP 400\): The cutoff time has passed/,
    );
  });

  it('still reports the status when the error body is not JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response('<html>gateway</html>', { status: 502 }));
    await expect(client(fetchImpl).getChildren()).rejects.toThrow(
      /GetChildren failed \(HTTP 502\)$/,
    );
  });

  it('hints at the credentials on a 401', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('', { status: 401 }));
    try {
      await client(fetchImpl).getChildren();
      expect.unreachable('a 401 must throw');
    } catch (err) {
      expect((err as McpToolError).hint).toMatch(/PICKUPPATROL_USERNAME/);
    }
  });

  it('leaves the hint off an ordinary upstream failure', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('', { status: 500 }));
    try {
      await client(fetchImpl).getChildren();
      expect.unreachable('a 500 must throw');
    } catch (err) {
      expect((err as McpToolError).hint).toBeUndefined();
    }
  });

  // A 200 carrying HTML is the sign-in page, not data — parsing it blind would
  // surface a JSON syntax error instead of the actual problem.
  it('names the likely cause when a 200 is not JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response('<html>sign in</html>'));
    await expect(client(fetchImpl).getChildren()).rejects.toThrow(/returned a non-JSON response/);
  });
});

describe('read helpers', () => {
  it.each([
    ['getSession', [], 'GetSession', ''],
    ['getChildren', [], 'GetChildren', ''],
    ['getStudent', [7], 'GetStudent', '?StudentId=7'],
    ['getDefaultPlansReviewNeeded', [], 'GetDefaultPlansReviewNeeded', ''],
    ['getParentPlans', ['2026-08-01', '2026-08-31'], 'GetParentPlans', '?StartDate=2026-08-01&EndDate=2026-08-31'],
    ['getTransportations', [1703], 'GetTransportations', '?SchoolId=1703'],
    ['getCarNumbers', [1703], 'GetCarNumbers', '?SchoolId=1703'],
    ['getSchool', [1703], 'GetSchool', '?SchoolId=1703'],
    ['getSchoolNotifyTimes', [1703], 'GetSchoolNotifyTimes', '?SchoolId=1703'],
    ['getSchoolSettings', [1703], 'GetSchoolSettings', '?SchoolId=1703'],
    ['getInvalidPlanDates', [1703], 'GetInvalidPlanDates', '?SchoolId=1703'],
    ['getBoldedDates', ['2026-08-01', '2026-08-31'], 'GetBoldedDates', '?StartDate=2026-08-01&EndDate=2026-08-31'],
  ] as const)('%s calls %s%s', async (method, args, dto, query) => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response('{}'));
    const c = client(fetchImpl) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    await c[method]!(...args);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://app.pickuppatrol.net/api/json/reply/${dto}${query}`,
    );
  });
});

describe('construction', () => {
  it('builds its own auth from credentials when none is injected', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ BearerToken: 'jwt' })));
    const c = new PickUpPatrolClient({ username: 'u', password: 'p', fetchImpl });
    await c.getSession();
    // First call is the login, second is the read.
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/Authenticate');
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/GetSession');
  });
});
