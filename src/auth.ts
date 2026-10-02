import {
  readEnvVar,
  McpToolError,
  CookieJar,
  EdgeBlockedError,
  detectEdgeBlock,
} from '@chrischall/mcp-utils';
import type { AuthenticateResponse, ResponseStatus } from './types.js';

export const BASE_URL = 'https://app.pickuppatrol.net';
export const BASE_PATH = '/api/json/reply';

/** Upper bound on any one request to PickUp Patrol, sign-in included. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Minimal `fetch` seam so tests never open a socket. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * What a successful login yields. PickUp Patrol's ServiceStack deployment can
 * authenticate either way and the SPA is built for both: its client reads a
 * `bearerToken` out of `localStorage` when one is present, and otherwise rides
 * the `ss-id`/`ss-pid` session cookies it sets `credentials: 'include'` for.
 * We keep whichever the server actually hands back and send both when we have
 * them, so the client does not depend on which mode the deployment is in.
 */
export interface PupSession {
  /** `Authorization: Bearer …`, when the deployment issues JWTs. */
  bearerToken: string | null;
  /** Exchangeable for a fresh bearer token via `GetAccessToken`. */
  refreshToken: string | null;
  /** `Cookie:` header value built from every `Set-Cookie` the login returned. */
  cookieHeader: string;
}

export interface AuthOptions {
  username?: string;
  password?: string;
  fetchImpl?: FetchLike;
  /** Sign-in timeout; defaults to `REQUEST_TIMEOUT_MS`. A test seam. */
  timeoutMs?: number;
}

/**
 * Pull the most useful message out of a ServiceStack error envelope. Field
 * errors are more specific than the top-level message, so they win.
 */
export function describeResponseStatus(status: ResponseStatus | null | undefined): string | null {
  if (!status) return null;
  const fieldError = status.Errors?.find((e) => e?.Message);
  return fieldError?.Message ?? status.Message ?? status.ErrorCode ?? null;
}

/** The service name {@link EdgeBlockedError} messages carry. */
export const SERVICE = 'PickUp Patrol';

/**
 * PickUp Patrol JUDGED the username and password and refused them. Its own
 * class so the healthcheck can say `credential_rejected` without matching
 * message prose.
 */
export class SignInRejectedError extends McpToolError {
  constructor(message: string, hint: string) {
    super(message, { hint });
    this.name = 'SignInRejectedError';
  }
}

/**
 * The sign-in "succeeded" but produced no usable session — in practice a
 * two-factor account, which this server does not complete.
 */
export class UnusableSessionError extends McpToolError {
  constructor(message: string, hint: string) {
    super(message, { hint });
    this.name = 'UnusableSessionError';
  }
}

/**
 * Was this response refused by a CDN/WAF in front of PickUp Patrol rather than
 * by PickUp Patrol? Reads a CLONE, so the caller's body stays readable. A JSON
 * body is never a refusal page, so it is not read.
 */
export async function edgeBlockOfResponse(res: Response): Promise<{ vendor: string } | null> {
  const byHeaders = detectEdgeBlock({ status: res.status, headers: res.headers });
  if (byHeaders !== null) return byHeaders;
  if (/json/i.test(String(res.headers.get('content-type')))) return null;
  let body: string;
  try {
    body = await res.clone().text();
  } catch {
    return null;
  }
  return detectEdgeBlock({ body, status: res.status, headers: res.headers });
}

/**
 * Owns the login lifecycle: one lazy, single-flight sign-in; a cached
 * *permanent* failure for anything that means "these credentials will never
 * work"; and exactly one re-login + replay when a request comes back 401.
 */
export class PickUpPatrolAuth {
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly configError: Error | null;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  private session: PupSession | null = null;
  private inFlight: Promise<PupSession> | null = null;
  private permanentError: Error | null = null;

  constructor(opts: AuthOptions = {}) {
    const username = opts.username ?? readEnvVar('PICKUPPATROL_USERNAME');
    const password = opts.password ?? readEnvVar('PICKUPPATROL_PASSWORD');

    // Deferred config error: the server must still boot (and answer the host's
    // install-time tools/list probe) with no credentials set. The error is
    // raised at request time instead.
    if (!username || !password) {
      this.username = null;
      this.password = null;
      this.configError = new McpToolError(
        'PICKUPPATROL_USERNAME and PICKUPPATROL_PASSWORD are required',
        {
          hint: 'Set both in the MCP host config (or a local .env) to the email and password you use at https://app.pickuppatrol.net/.',
        },
      );
    } else {
      this.username = username;
      this.password = password;
      this.configError = null;
    }

    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * Where the credentials came from, for the healthcheck — `'env'` when a
   * username and password are configured (from the environment or the
   * constructor), `null` when they are not. Never the credential itself.
   */
  get credentialSource(): string | null {
    return this.configError ? null : 'env';
  }

  /** True once a login has succeeded — used by the healthcheck tool. */
  get isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * A valid session, logging in on first use. Concurrent callers share one
   * in-flight login rather than racing several sign-ins at the same account.
   */
  async ensure(): Promise<PupSession> {
    if (this.configError) throw this.configError;
    if (this.permanentError) throw this.permanentError;
    if (this.session) return this.session;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.login()
      .then((session) => {
        this.session = session;
        return session;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Drop the cached session so the next `ensure()` signs in again. */
  invalidate(): void {
    this.session = null;
  }

  /**
   * Run an authenticated request. On a 401 the session is dropped, re-minted
   * once and the call replayed exactly once — never more, so a server that
   * answers 401 unconditionally cannot turn into a login loop against the
   * account.
   *
   * If the session minted for the replay is rejected too, the sign-in is
   * "succeeding" without producing a usable session — in practice a
   * two-factor account. The login-time check cannot see that (Azure's
   * ARRAffinity cookie means the jar is never empty), so this is where it is
   * caught, and it is cached as permanent: otherwise every later call would
   * spend two more sign-ins against the account.
   *
   * A 401 that is a CDN/WAF refusal page is NOT a rejected session: the
   * request never reached PickUp Patrol, so the session is kept, no sign-in is
   * spent, and the block is reported as an {@link EdgeBlockedError}
   * (chrischall/mcp-host#1015).
   */
  async withAuth(call: (session: PupSession) => Promise<Response>): Promise<Response> {
    const first = await call(await this.ensure());
    if (first.status !== 401) return first;
    await this.throwIfEdgeBlocked(first);

    this.invalidate();
    const replay = await call(await this.ensure());
    if (replay.status !== 401) return replay;
    await this.throwIfEdgeBlocked(replay);

    this.invalidate();
    this.permanentError = new UnusableSessionError(
      'PickUp Patrol accepted the sign-in but rejected the session it just issued',
      'This usually means the account has two-factor authentication enabled, which this server does not yet complete. Sign in at https://app.pickuppatrol.net/ to check, then restart the server.',
    );
    throw this.permanentError;
  }

  private async throwIfEdgeBlocked(res: Response): Promise<void> {
    const edge = await edgeBlockOfResponse(res);
    if (edge !== null) {
      throw new EdgeBlockedError(res.status, edge.vendor, { service: SERVICE });
    }
  }

  private async login(): Promise<PupSession> {
    // Bounded like every other request. `ensure()` shares this promise with
    // every concurrent and later caller until it settles, so an unanswered
    // sign-in would otherwise stall every tool — the healthcheck included —
    // for as long as undici's own ~300s default. The signal also covers the
    // body read below.
    const signal = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${BASE_URL}${BASE_PATH}/Authenticate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          provider: 'credentials',
          UserName: this.username,
          Password: this.password,
          RememberMe: true,
        }),
        redirect: 'manual',
        signal,
      });
      text = await res.text().catch((err: unknown) => {
        if (signal.aborted) throw err;
        return '';
      });
    } catch (err) {
      // Transient: a timeout says nothing about the credentials, so it is
      // never cached as permanentError and the next call signs in afresh.
      if (signal.aborted) {
        throw new McpToolError(
          `PickUp Patrol did not answer the sign-in within ${this.timeoutMs / 1000}s`,
          { hint: 'The service may be slow or down. Try again shortly.' },
        );
      }
      throw err;
    }

    let body: AuthenticateResponse | null = null;
    try {
      body = JSON.parse(text) as AuthenticateResponse | null;
    } catch {
      // Not JSON: a gateway page, or a CDN/WAF refusal page. A refusal never
      // reached PickUp Patrol, so the credentials were not judged — it is
      // reported as a block and never cached as permanent, so the next call
      // signs in afresh (chrischall/mcp-host#1015).
      const edge = detectEdgeBlock({ body: text, status: res.status, headers: res.headers });
      if (edge !== null) {
        throw new EdgeBlockedError(res.status, edge.vendor, {
          service: SERVICE,
          method: 'POST',
          path: `${BASE_PATH}/Authenticate`,
        });
      }
    }

    if (!res.ok) {
      const detail = describeResponseStatus(body?.ResponseStatus);
      const code = body?.ResponseStatus?.ErrorCode ?? '';
      const message = `PickUp Patrol rejected the sign-in${detail ? `: ${detail}` : ` (HTTP ${res.status})`}`;
      const hint = 'Check PICKUPPATROL_USERNAME and PICKUPPATROL_PASSWORD against https://app.pickuppatrol.net/.';
      // Only a credential the service JUDGED is a rejection. A 5xx or an
      // unexplained 4xx stays a plain error, so the healthcheck reports it by
      // status rather than sending someone to change a working password.
      const judged = res.status >= 400 && res.status < 500 && code.startsWith('LOGIN-ERROR');
      const error = judged ? new SignInRejectedError(message, hint) : new McpToolError(message, { hint });

      // A credential the service has *judged* is never retried. PickUp Patrol
      // counts failures against the account and clearing a lockout goes
      // through their support desk, so a retry loop would destroy the only
      // auth path we have. Caching the error means every later call fails
      // instantly with the same message instead of spending another attempt.
      // A 5xx or a network blip is left transient so the next call retries.
      if (judged) {
        this.permanentError = error;
      }
      throw error;
    }

    // Two-factor accounts return a session that is not yet usable; the SPA
    // routes them to /two-factor. A login with no token and no cookie at all
    // is caught here; the live deployment always sets ARRAffinity, though, so
    // the usual two-factor signal is the rejected fresh session in withAuth().
    const cookieHeader = collectCookieHeader(res);
    const bearerToken = body?.BearerToken ?? null;
    if (!bearerToken && !cookieHeader) {
      this.permanentError = new UnusableSessionError(
        'PickUp Patrol accepted the sign-in but returned no session token or cookie',
        'This usually means the account has two-factor authentication enabled, which this server does not yet complete. Sign in at https://app.pickuppatrol.net/ to check.',
      );
      throw this.permanentError;
    }

    return { bearerToken, refreshToken: body?.RefreshToken ?? null, cookieHeader };
  }
}

/**
 * Build a `Cookie:` request header from every `Set-Cookie` on a response.
 * ServiceStack sets more than one (`ss-id`, `ss-pid`, `ss-opt`) alongside
 * Azure's `ARRAffinity` pair, and the session needs all of them — so this
 * keeps the whole jar rather than picking a named cookie out of it. `CookieJar`
 * also drops the deletion markers a login response mixes in, which some
 * upstreams reject when echoed back.
 */
export function collectCookieHeader(res: Response): string {
  const jar = new CookieJar();
  jar.absorb(res.headers);
  return jar.header();
}
