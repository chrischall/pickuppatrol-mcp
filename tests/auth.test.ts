import { describe, expect, it, vi } from 'vitest';
import type { McpToolError } from '@chrischall/mcp-utils';
import { PickUpPatrolAuth, collectCookieHeader, describeResponseStatus } from '../src/auth.js';

function jsonResponse(
  body: unknown,
  init: { status?: number; setCookie?: string[] } = {},
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of init.setCookie ?? []) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

const CREDS = { username: 'parent@example.com', password: 'correct horse' };

/**
 * A fetch mock that builds a FRESH Response per call. `mockResolvedValue` hands
 * back the same object every time, and a Response body can only be read once —
 * so a re-login would see an already-consumed body and misreport itself as a
 * two-factor account.
 */
function mockFetch(build: () => Response) {
  return vi.fn().mockImplementation(async () => build());
}

describe('PickUpPatrolAuth', () => {
  it('defers the missing-credentials error to request time so the server can boot', async () => {
    const auth = new PickUpPatrolAuth({ fetchImpl: vi.fn() });
    await expect(auth.ensure()).rejects.toThrow(
      /PICKUPPATROL_USERNAME and PICKUPPATROL_PASSWORD are required/,
    );
  });

  it('posts the credentials DTO the web app posts', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    await new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.pickuppatrol.net/api/json/reply/Authenticate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      provider: 'credentials',
      UserName: 'parent@example.com',
      Password: 'correct horse',
      RememberMe: true,
    });
  });

  it('keeps the bearer token when the deployment issues one', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ BearerToken: 'jwt-abc', RefreshToken: 'refresh-xyz' }),
    );
    const session = await new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure();
    expect(session.bearerToken).toBe('jwt-abc');
    expect(session.refreshToken).toBe('refresh-xyz');
  });

  // The live deployment authenticates by session cookie: the SPA reads a
  // bearerToken out of localStorage but nothing writes one, and its client
  // fetches with credentials: 'include'.
  it('falls back to the session cookies when no bearer token comes back', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { BearerToken: null },
        { setCookie: ['ss-id=abc; Path=/; HttpOnly', 'ss-pid=def; Path=/; HttpOnly'] },
      ),
    );
    const session = await new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure();
    expect(session.bearerToken).toBeNull();
    expect(session.cookieHeader).toBe('ss-id=abc; ss-pid=def');
  });

  it('signs in once for a burst of concurrent callers', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    await Promise.all([auth.ensure(), auth.ensure(), auth.ensure()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reuses the session on later calls', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    await auth.ensure();
    await auth.ensure();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated).toBe(true);
  });

  // The rule that matters most here: PickUp Patrol counts failed sign-ins
  // against the account and clearing a lockout goes through their support
  // desk. A retry loop would destroy the only auth path the server has.
  it('never re-sends a credential the service has rejected', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        {
          ResponseStatus: {
            ErrorCode: 'LOGIN-ERROR-EMAIL-NOT-FOUND',
            Message: "Couldn't find your PickUp Patrol Account.",
          },
        },
        { status: 400 },
      ),
    );
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });

    await expect(auth.ensure()).rejects.toThrow(/Couldn't find your PickUp Patrol Account/);
    await expect(auth.ensure()).rejects.toThrow(/Couldn't find your PickUp Patrol Account/);
    await expect(auth.ensure()).rejects.toThrow(/Couldn't find your PickUp Patrol Account/);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient server failure, which spends no login attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('gateway down', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });

    await expect(auth.ensure()).rejects.toThrow(/HTTP 503/);
    await expect(auth.ensure()).resolves.toMatchObject({ bearerToken: 'jwt-abc' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a two-factor account rather than failing later with an opaque 401', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: null }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    await expect(auth.ensure()).rejects.toThrow(/no session token or cookie/);
    // Also permanent: retrying cannot help, and each attempt costs a login.
    await expect(auth.ensure()).rejects.toThrow(/no session token or cookie/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-JSON login failure with its status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 500 }));
    await expect(new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure()).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('hints at the environment variables to check', async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ ResponseStatus: { ErrorCode: 'LOGIN-ERROR-BAD' } }, { status: 400 }),
    );
    try {
      await new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure();
      expect.unreachable('a rejected sign-in must throw');
    } catch (err) {
      expect((err as McpToolError).hint).toMatch(/PICKUPPATROL_USERNAME/);
    }
  });
});

describe('withAuth', () => {
  it('passes a successful response straight through', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    const call = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await auth.withAuth(call);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('re-signs-in and replays once when the session has expired', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    const call = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const res = await auth.withAuth(call);
    expect(res.status).toBe(200);
    expect(call).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A server that answers 401 unconditionally must not become a login loop
  // against the account — one replay, then the 401 is the answer.
  it('replays exactly once, then surfaces the 401', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    const call = vi.fn().mockImplementation(async () => new Response('', { status: 401 }));

    const res = await auth.withAuth(call);
    expect(res.status).toBe(401);
    expect(call).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('drops the cached session on invalidate', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ BearerToken: 'jwt-abc' }));
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    await auth.ensure();
    auth.invalidate();
    expect(auth.isAuthenticated).toBe(false);
    await auth.ensure();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('describeResponseStatus', () => {
  it('prefers a field error, which names what was actually wrong', () => {
    expect(
      describeResponseStatus({
        Message: 'general',
        Errors: [{ FieldName: 'UserName', Message: 'specific' }],
      }),
    ).toBe('specific');
  });

  it('falls back to the top-level message, then the code', () => {
    expect(describeResponseStatus({ Message: 'general' })).toBe('general');
    expect(describeResponseStatus({ ErrorCode: 'CODE' })).toBe('CODE');
    expect(describeResponseStatus({ Errors: [{ FieldName: 'x' }] })).toBeNull();
  });

  it('returns null for a missing envelope', () => {
    expect(describeResponseStatus(null)).toBeNull();
    expect(describeResponseStatus(undefined)).toBeNull();
  });
});

describe('collectCookieHeader', () => {
  it('keeps every cookie the login sets, not just a named one', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'ss-id=abc; Path=/');
    headers.append('set-cookie', 'ARRAffinity=xyz; Path=/');
    expect(collectCookieHeader(new Response('', { headers }))).toBe('ss-id=abc; ARRAffinity=xyz');
  });

  it('is empty when the response sets none', () => {
    expect(collectCookieHeader(new Response(''))).toBe('');
  });
});
