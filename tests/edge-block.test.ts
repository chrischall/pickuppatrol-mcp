import { describe, expect, it, vi } from 'vitest';
import { EdgeBlockedError, McpToolError } from '@chrischall/mcp-utils';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { PickUpPatrolAuth, edgeBlockOfResponse } from '../src/auth.js';
import { PickUpPatrolClient } from '../src/client.js';
import { registerAccountTools } from '../src/tools/account.js';

/**
 * A real Cloudflare "Sorry, you have been blocked" page, trimmed. The CDN in
 * front of the API answers with it BEFORE the credentials are looked at — so
 * it must never read as a rejected sign-in, and never cost one
 * (chrischall/mcp-host#1015).
 */
const CLOUDFLARE_BLOCK = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<head>
<title>Attention Required! | Cloudflare</title>
<meta charset="UTF-8" />
</head>
<body>
  <div id="cf-wrapper">
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <h1 data-translate="block_headline">Sorry, you have been blocked</h1>
      <h2 class="cf-subheadline">You are unable to access pickuppatrol.net</h2>
      <p>Cloudflare Ray ID: <strong class="font-semibold">8c1f2e3d4a5b6c7d</strong></p>
    </div>
  </div>
</body>
</html>`;

const CREDS = { username: 'parent@example.com', password: 'correct horse' };

function block(status = 403): Response {
  return new Response(CLOUDFLARE_BLOCK, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } });
}

function json(body: unknown, status = 200, setCookie: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of setCookie) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

const SIGNED_IN = () => json({ SessionId: 's' }, 200, ['ss-id=abc; path=/']);
const SESSION = { UserId: 42, Email: 'parent@example.com', Children: [{ StudentId: 1, SchoolId: 2 }] };
const REJECTED = () =>
  json(
    { ResponseStatus: { ErrorCode: 'LOGIN-ERROR-INVALID', Message: 'Invalid UserName or Password' } },
    401,
  );

/** Route Authenticate and everything else to separate builders; count each. */
function router(opts: { signIn: () => Response; api: () => Response }) {
  const calls = { signIn: 0, api: 0 };
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.endsWith('/Authenticate')) {
      calls.signIn++;
      return opts.signIn();
    }
    calls.api++;
    return opts.api();
  });
  return { fetchImpl, calls };
}

describe('edge blocks (CDN/WAF refusal pages)', () => {
  it('a blocked sign-in throws EdgeBlockedError, is not cached, and is retried next call', async () => {
    let blocked = true;
    const { fetchImpl, calls } = router({ signIn: () => (blocked ? block() : SIGNED_IN()), api: () => json(SESSION) });
    const client = new PickUpPatrolClient({ ...CREDS, fetchImpl });

    const err = await client.getSession().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgeBlockedError);
    expect((err as EdgeBlockedError).vendor).toBe('Cloudflare');
    expect((err as Error).message).not.toMatch(/rejected the sign-in/);

    blocked = false;
    await expect(client.getSession()).resolves.toMatchObject({ UserId: 42 });
    expect(calls.signIn).toBe(2);
  });

  it('a 401 block page on an API call keeps the session — no re-login, no permanent error', async () => {
    let blocked = true;
    const { fetchImpl, calls } = router({ signIn: SIGNED_IN, api: () => (blocked ? block(401) : json(SESSION)) });
    const auth = new PickUpPatrolAuth({ ...CREDS, fetchImpl });
    const client = new PickUpPatrolClient({ auth, fetchImpl });

    await expect(client.getSession()).rejects.toBeInstanceOf(EdgeBlockedError);
    expect(calls.signIn).toBe(1);
    expect(auth.isAuthenticated).toBe(true);

    blocked = false;
    await expect(client.getSession()).resolves.toMatchObject({ UserId: 42 });
    expect(calls.signIn).toBe(1);
  });

  it('a 403 block page on an API call is an EdgeBlockedError, not "check your password"', async () => {
    const { fetchImpl } = router({ signIn: SIGNED_IN, api: () => block(403) });
    const err = await new PickUpPatrolClient({ ...CREDS, fetchImpl }).getSession().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgeBlockedError);
    expect((err as McpToolError).hint ?? '').not.toMatch(/PICKUPPATROL_PASSWORD/);
  });

  it('control: a genuine 401 still re-signs-in once and replays', async () => {
    let first = true;
    const { fetchImpl, calls } = router({
      signIn: SIGNED_IN,
      api: () => {
        if (first) {
          first = false;
          return json({ ResponseStatus: { ErrorCode: 'Unauthorized' } }, 401);
        }
        return json(SESSION);
      },
    });
    await expect(new PickUpPatrolClient({ ...CREDS, fetchImpl }).getSession()).resolves.toMatchObject({ UserId: 42 });
    expect(calls.signIn).toBe(2);
  });
});

describe('pup_healthcheck reports a kind', () => {
  async function check(client: PickUpPatrolClient) {
    const h = await createTestHarness((s) => registerAccountTools(s, client));
    try {
      return parseToolResult<Record<string, any>>(await h.callTool('pup_healthcheck'));
    } finally {
      await h.close();
    }
  }

  it('ok: keeps signedInAs / studentCount / version beside the shared envelope', async () => {
    const { fetchImpl } = router({ signIn: SIGNED_IN, api: () => json(SESSION) });
    const out = await check(new PickUpPatrolClient({ ...CREDS, fetchImpl }));
    expect(out).toMatchObject({
      ok: true,
      signedInAs: 'parent@example.com',
      studentCount: 1,
      credential: { source: 'env', resolved: true },
    });
    expect(typeof out.version).toBe('string');
    expect(out.error).toBeUndefined();
  });

  it('edge_blocked: a block page on the sign-in is not reported as a bad password', async () => {
    const { fetchImpl } = router({ signIn: () => block(403), api: () => json(SESSION) });
    const out = await check(new PickUpPatrolClient({ ...CREDS, fetchImpl }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatchObject({ kind: 'edge_blocked', detail: { vendor: 'Cloudflare' } });
    expect(out.hint).toMatch(/CDN\/WAF/);
  });

  it('edge_blocked: a block page on the probe', async () => {
    const { fetchImpl } = router({ signIn: SIGNED_IN, api: () => block(401) });
    const out = await check(new PickUpPatrolClient({ ...CREDS, fetchImpl }));
    expect(out.error).toMatchObject({ kind: 'edge_blocked' });
  });

  it('control — credential_rejected: the service judged the password', async () => {
    const { fetchImpl } = router({ signIn: REJECTED, api: () => json(SESSION) });
    const out = await check(new PickUpPatrolClient({ ...CREDS, fetchImpl }));
    expect(out.error).toMatchObject({ kind: 'credential_rejected' });
    expect(out.error.message).toMatch(/Invalid UserName or Password/);
    expect(out.hint).toMatch(/PICKUPPATROL_USERNAME/);
  });

  it('no_credential: nothing configured, nothing probed', async () => {
    vi.stubEnv('PICKUPPATROL_USERNAME', '');
    vi.stubEnv('PICKUPPATROL_PASSWORD', '');
    try {
      const { fetchImpl } = router({ signIn: SIGNED_IN, api: () => json(SESSION) });
      const out = await check(new PickUpPatrolClient({ fetchImpl }));
      expect(out.error).toMatchObject({ kind: 'no_credential' });
      expect(out.credential).toMatchObject({ source: null, resolved: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a two-factor account (session issued, then rejected) is verification_pending, not a bad password', async () => {
    const { fetchImpl } = router({
      signIn: SIGNED_IN,
      api: () => json({ ResponseStatus: { ErrorCode: 'Unauthorized' } }, 401),
    });
    const out = await check(new PickUpPatrolClient({ ...CREDS, fetchImpl }));
    expect(out.error).toMatchObject({ kind: 'verification_pending' });
    expect(out.hint).toMatch(/two-factor/);
  });
});

describe('edgeBlockOfResponse', () => {
  it('trusts cf-mitigated without reading the body', async () => {
    const res = new Response('{}', { status: 401, headers: { 'cf-mitigated': 'challenge', 'content-type': 'application/json' } });
    await expect(edgeBlockOfResponse(res)).resolves.toEqual({ vendor: 'Cloudflare' });
    expect(res.bodyUsed).toBe(false);
  });

  it('never reads a JSON body (no refusal page is JSON)', async () => {
    const res = json({ ResponseStatus: { ErrorCode: 'Unauthorized' } }, 401);
    await expect(edgeBlockOfResponse(res)).resolves.toBeNull();
    expect(res.bodyUsed).toBe(false);
  });

  it('leaves the caller body readable, and treats an unreadable body as "not shown to be a block"', async () => {
    const res = block(401);
    await expect(edgeBlockOfResponse(res)).resolves.toEqual({ vendor: 'Cloudflare' });
    await expect(res.text()).resolves.toContain('Cloudflare');
    await expect(edgeBlockOfResponse(res)).resolves.toBeNull();
  });
});

describe('sign-in body read', () => {
  it('a body that fails to read (not a timeout) is treated as empty, not a block', async () => {
    const fetchImpl = vi.fn(async () =>
      ({ ok: false, status: 502, headers: new Headers(), text: () => Promise.reject(new Error('reset')) }) as unknown as Response,
    );
    const err = await new PickUpPatrolAuth({ ...CREDS, fetchImpl }).ensure().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(EdgeBlockedError);
    expect((err as Error).message).toMatch(/HTTP 502/);
  });
});
