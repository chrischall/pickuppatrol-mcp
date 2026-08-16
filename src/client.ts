import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadDotenvSafely, McpToolError, buildQueryString } from '@chrischall/mcp-utils';
import { PickUpPatrolAuth, BASE_URL, BASE_PATH, describeResponseStatus } from './auth.js';
import type { AuthOptions, FetchLike, PupSession } from './auth.js';
import type {
  DefaultsReviewNeeded,
  PlanEdit,
  PlanUpdate,
  School,
  SchoolNotifyTimes,
  SessionResponse,
  Student,
  Transportation,
} from './types.js';

// Load .env for local dev; silently skip when dotenv is unavailable (the mcpb
// bundle externalises it). The try/catch guards a runtime where
// `import.meta.url` is undefined and `fileURLToPath` would throw at module
// init — such a runtime has no filesystem or .env to read anyway.
try {
  const dir = dirname(fileURLToPath(import.meta.url));
  await loadDotenvSafely({ path: join(dir, '..', '.env'), override: false });
} catch {
  /* non-Node runtime: no .env to load */
}

const REQUEST_TIMEOUT_MS = 30_000;

export interface ClientOptions extends AuthOptions {
  auth?: PickUpPatrolAuth;
}

/**
 * Thin typed client over PickUp Patrol's ServiceStack API.
 *
 * Not `createApiClient`: that helper only emits `Authorization: Bearer …`,
 * while this deployment may authenticate by session cookie instead (see
 * `src/auth.ts`). Requests therefore carry whichever of the two the login
 * produced, and errors are unwrapped from ServiceStack's `ResponseStatus`
 * envelope rather than a plain status line.
 */
export class PickUpPatrolClient {
  private readonly auth: PickUpPatrolAuth;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ClientOptions = {}) {
    this.auth = opts.auth ?? new PickUpPatrolAuth(opts);
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** Request a DTO by name. GET args go on the query string, others in the body. */
  async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    dto: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const query = method === 'GET' && args ? buildQueryString(args) : '';
    const url = `${BASE_URL}${BASE_PATH}/${dto}${query}`;

    const res = await this.auth.withAuth((session) =>
      this.fetchImpl(url, {
        method,
        headers: this.headers(session),
        body: method === 'GET' || args === undefined ? undefined : JSON.stringify(args),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    return this.parse<T>(res, dto);
  }

  private headers(session: PupSession): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (session.bearerToken) headers['Authorization'] = `Bearer ${session.bearerToken}`;
    if (session.cookieHeader) headers['Cookie'] = session.cookieHeader;
    return headers;
  }

  private async parse<T>(res: Response, dto: string): Promise<T> {
    const text = await res.text();

    if (!res.ok) {
      // ServiceStack returns its error envelope as JSON, but a gateway or an
      // auth redirect can return HTML — so the parse is best-effort and the
      // status is always part of the message.
      let detail: string | null = null;
      try {
        detail = describeResponseStatus(
          (JSON.parse(text) as { ResponseStatus?: Parameters<typeof describeResponseStatus>[0] })
            .ResponseStatus,
        );
      } catch {
        detail = null;
      }
      throw new McpToolError(
        `PickUp Patrol ${dto} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
        {
          hint:
            res.status === 401 || res.status === 403
              ? 'The session was rejected. Check PICKUPPATROL_USERNAME and PICKUPPATROL_PASSWORD.'
              : undefined,
        },
      );
    }

    // Several write DTOs (`UpdatePlans`, `SetDefaultsReviewed`) declare no
    // response and answer with an empty body.
    if (text.trim() === '') return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new McpToolError(`PickUp Patrol ${dto} returned a non-JSON response`, {
        hint: 'This usually means the request was redirected to the sign-in page. Check the credentials and try again.',
      });
    }
  }

  // ---- reads -------------------------------------------------------------

  getSession(): Promise<SessionResponse> {
    return this.call<SessionResponse>('GET', 'GetSession');
  }

  getChildren(): Promise<Student[]> {
    return this.call<Student[]>('GET', 'GetChildren');
  }

  getStudent(studentId: number): Promise<Student> {
    return this.call<Student>('GET', 'GetStudent', { StudentId: studentId });
  }

  getDefaultPlansReviewNeeded(): Promise<DefaultsReviewNeeded[]> {
    return this.call<DefaultsReviewNeeded[]>('GET', 'GetDefaultPlansReviewNeeded');
  }

  getParentPlans(startDate: string, endDate: string): Promise<unknown[]> {
    return this.call<unknown[]>('GET', 'GetParentPlans', {
      StartDate: startDate,
      EndDate: endDate,
    });
  }

  getPlanEdit(planDate: string, studentId: number): Promise<PlanEdit> {
    return this.call<PlanEdit>('GET', 'GetPlanEdit', {
      PlanDate: planDate,
      StudentId: studentId,
    });
  }

  getTransportations(schoolId: number): Promise<Transportation[]> {
    return this.call<Transportation[]>('GET', 'GetTransportations', { SchoolId: schoolId });
  }

  getCarNumbers(schoolId: number): Promise<string[]> {
    return this.call<string[]>('GET', 'GetCarNumbers', { SchoolId: schoolId });
  }

  getSchool(schoolId: number): Promise<School> {
    return this.call<School>('GET', 'GetSchool', { SchoolId: schoolId });
  }

  getSchoolNotifyTimes(schoolId: number): Promise<SchoolNotifyTimes> {
    return this.call<SchoolNotifyTimes>('GET', 'GetSchoolNotifyTimes', { SchoolId: schoolId });
  }

  getSchoolSettings(schoolId: number): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('GET', 'GetSchoolSettings', { SchoolId: schoolId });
  }

  getInvalidPlanDates(schoolId: number): Promise<string[]> {
    return this.call<string[]>('GET', 'GetInvalidPlanDates', { SchoolId: schoolId });
  }

  getBoldedDates(startDate: string, endDate: string): Promise<string[]> {
    return this.call<string[]>('GET', 'GetBoldedDates', {
      StartDate: startDate,
      EndDate: endDate,
    });
  }

  // ---- writes ------------------------------------------------------------

  /**
   * The one-off (calendar) plan write. One array element per date, so a single
   * call can set a run of dates. A `null` TransportationId reverts the date to
   * the student's default plan.
   */
  updatePlans(plans: PlanUpdate[]): Promise<void> {
    return this.call<void>('PUT', 'UpdatePlans', { Plans: plans });
  }

  /**
   * The default-plans write. PickUp Patrol has no dedicated endpoint: the SPA
   * PUTs the WHOLE student record back with `DefaultPlans` replaced, so callers
   * must pass a `GetStudent` result with only that field changed.
   */
  updateStudent(student: Student): Promise<void> {
    return this.call<void>('PUT', 'Student', student as unknown as Record<string, unknown>);
  }

  setDefaultsReviewed(studentId: number, reviewed: boolean): Promise<void> {
    return this.call<void>('PUT', 'SetDefaultsReviewed', {
      StudentId: studentId,
      Reviewed: reviewed,
    });
  }
}

/**
 * Module-level singleton shared by every tool module. Built here (not in
 * `index.ts`) so the deferred-config-error pattern holds: the server boots and
 * answers the host's install-time `tools/list` probe with no credentials set,
 * and the configuration error only surfaces on the first tool call.
 */
export const client = new PickUpPatrolClient();
