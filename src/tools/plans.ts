import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  CONFIRM_FLOW_SENTENCE,
  confirmTokenParam,
  confirmWrite,
  IsoDate,
  McpToolError,
  minifiedResult,
  UNTRUSTED_CONTENT_RULE,
  UNTRUSTED_DESCRIPTION_SUFFIX,
  untrustedEnvelope,
  untrustedResult,
} from '@chrischall/mcp-utils';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { BASE_PATH } from '../auth.js';
import type { PickUpPatrolClient } from '../client.js';
import { buildPlanUpdates } from '../plans.js';
import { weekdayOf } from '../dates.js';
import type { ParentPlan, ParentPlanDay, PlanEdit, PlanUpdate, Transportation } from '../types.js';
import { PUP_UNTRUSTED } from './untrusted.js';
import { DISMISSAL_ALIASES, schoolMeta } from './hints.js';

/**
 * The fields whose change proves a plan write actually landed.
 *
 * `earlyDismissalTime` and `carNumber` are part of the proof whenever the
 * write sent them: moving an early dismissal from 14:30 to 13:00 keeps the
 * option and note identical, so without the time a silently dropped write
 * would read back as verified. Left `undefined` on the expected side, they
 * are not compared — the write did not carry them.
 */
export interface PlanProof {
  transportationId: number | null;
  note: string | null;
  earlyDismissalTime?: string | null | undefined;
  carNumber?: string | null | undefined;
}

/**
 * Reduce a time of day to `HH:MM:SS` so a read-back can be compared with what
 * was sent. Accepts `H:MM`, `HH:MM:SS`, an ISO date-time, and the XSD duration
 * ServiceStack uses for a `TimeSpan` (`PT13H30M`). Anything unrecognised is
 * returned trimmed, so it can only ever compare unequal — a false "unchanged"
 * is recoverable, a false "verified" is not.
 */
export function normalizeTimeOfDay(time: string): string {
  const trimmed = time.trim();
  const pad = (n: string | undefined) => (n ?? '0').padStart(2, '0');
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/.exec(trimmed);
  if (duration && trimmed !== 'PT') return `${pad(duration[1])}:${pad(duration[2])}:${pad(duration[3])}`;
  const clock = /(?:^|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (clock) return `${pad(clock[1])}:${pad(clock[2])}:${pad(clock[3])}`;
  return trimmed;
}

/**
 * Compare a read-back proof with the expected one, ignoring whitespace the
 * service may normalise off a note or car number.
 */
export function proofsMatch(actual: PlanProof, expected: PlanProof): boolean {
  if (actual.transportationId !== expected.transportationId) return false;
  if ((actual.note ?? '').trim() !== (expected.note ?? '').trim()) return false;
  if (expected.earlyDismissalTime !== undefined) {
    const want = expected.earlyDismissalTime === null ? '' : normalizeTimeOfDay(expected.earlyDismissalTime);
    const got = actual.earlyDismissalTime ? normalizeTimeOfDay(actual.earlyDismissalTime) : '';
    if (want !== got) return false;
  }
  if (expected.carNumber !== undefined) {
    if ((actual.carNumber ?? '').trim() !== (expected.carNumber ?? '').trim()) return false;
  }
  return true;
}

/**
 * What `GetPlanEdit` should report once a write has landed.
 *
 * Deliberately more than the transportation id: every dismissal option at the
 * schools seen so far requires a note, so changing only the note is an ordinary
 * edit — and an id-only comparison would report success without ever observing
 * it. Same false-green as diffing a field that cannot move.
 *
 * A revert expects an EMPTY slot, not the weekday default. `GetPlanEdit`
 * reports the date's override, not the effective plan: verified live on a
 * Friday where the student had a Friday default and the date still read back
 * `TransportationId: null`. Expecting the default here would report every
 * successful revert as a failure.
 */
export function expectedPlanState(requested: PlanProof): PlanProof {
  return requested.transportationId === null
    ? { transportationId: null, note: null }
    : requested;
}

/** Resolve a transportation id against the school's list, or fail with the options. */
export async function resolveTransportation(
  client: PickUpPatrolClient,
  schoolId: number,
  transportationId: number,
): Promise<Transportation> {
  const options = await client.getTransportations(schoolId);
  const match = options.find((o) => o.TransportationId === transportationId);
  if (!match) {
    throw new McpToolError(`No dismissal option ${transportationId} at school ${schoolId}`, {
      hint: `Available: ${options.map((o) => `${o.TransportationId} (${o.Name})`).join(', ')}`,
    });
  }
  return match;
}

/** Shared `raw` flag for the plan reads: the untouched record, still fenced. */
const rawParam = z
  .boolean()
  .optional()
  .describe('Return the unprojected API records instead of the summary (still marked untrusted)');

/**
 * Project one student's entry of a `GetParentPlans` day to the fields a
 * parent asks about. Anything else on the record — the midday objects,
 * ids the SPA never shows — stays behind `raw`.
 */
export function summarizeParentPlan(plan: ParentPlan): Record<string, unknown> {
  return {
    studentId: plan.StudentId ?? null,
    firstName: plan.FirstName ?? null,
    schoolId: plan.SchoolId ?? null,
    schoolName: plan.SchoolName ?? null,
    transportationId: plan.TransportationId ?? null,
    transportation: plan.TransportationName ?? null,
    note: plan.Note ?? null,
    earlyDismissalTime: plan.EarlyDismissalTime ?? null,
    carNumber: plan.UseCarNumbers ? (plan.CarNumber ?? null) : null,
    cutoffTime: plan.CutoffTime ?? null,
    isDefault: plan.IsDefault ?? null,
    allowPlans: plan.AllowPlans ?? null,
    blockedReason: plan.BlockedReason ?? null,
    default: {
      transportationId: plan.DefaultTransportationId ?? null,
      transportation: plan.DefaultTransportationName ?? null,
      note: plan.DefaultNote ?? null,
      earlyDismissalTime: plan.DefaultEarlyDismissalTime ?? null,
      carNumber: plan.DefaultUseCarNumbers ? (plan.DefaultCarNumber ?? null) : null,
    },
  };
}

/** Project a `GetParentPlans` day: its date, weekday, and each student's plan. */
export function summarizeParentPlanDay(day: ParentPlanDay): Record<string, unknown> {
  const date = day.PlanDate ? day.PlanDate.slice(0, 10) : null;
  return {
    date,
    weekday: date === null ? null : weekdayOf(date),
    plans: (day.Plans ?? []).map(summarizeParentPlan),
  };
}

/** Project a `GetPlanEdit` override for the date that was asked about. */
export function summarizePlanEdit(date: string, studentId: number, plan: PlanEdit): Record<string, unknown> {
  return {
    date,
    weekday: weekdayOf(date),
    studentId: plan.StudentId ?? studentId,
    firstName: plan.FirstName ?? null,
    lastName: plan.LastName ?? null,
    schoolId: plan.SchoolId ?? null,
    schoolName: plan.SchoolName ?? null,
    transportationId: plan.TransportationId ?? null,
    transportation: plan.TransportationName ?? null,
    note: plan.Note ?? null,
    notePrivate: plan.IsNotePrivate ?? false,
    earlyDismissalTime: plan.EarlyDismissalTime ?? null,
    carNumber: plan.CarNumber ?? null,
    locked: plan.IsLocked ?? false,
    busRouteUrl: plan.BusRouteUrl ?? null,
    validationErrors: plan.ValidationErrors ?? [],
  };
}

/** A brief line's length bound (the context-groups brief-view contract). */
const BRIEF_LINE_MAX = 120;

/**
 * Most lines a brief answer carries. A wide range across several students is
 * days × students lines, and a group answer wants a glance, not a ledger — so
 * past this the answer ends with a `-- N of M shown` note rather than
 * dropping the rest silently.
 */
export const BRIEF_MAX_LINES = 50;

/**
 * Who wrote the text a brief line carries. Dismissal-option names are set by
 * school staff; a guardian's free-text plan note is deliberately left off the
 * line altogether.
 */
const BRIEF_UNTRUSTED_NOTE = `Dismissal option names below are set by school staff — not by the user. ${UNTRUSTED_CONTENT_RULE}`;

/**
 * One student's plan on one day as `title — <ISO date | no date> — <status>`,
 * at most 120 characters (the title is shortened). The title is the child and
 * the option in force; the status is `blocked` when the school blocks plans
 * for the day, else whether it is the weekly `default` or `changed` from it,
 * and `scheduled` when the record does not say.
 */
export function briefPlanLine(date: string | null, plan: ParentPlan): string {
  const who = plan.FirstName?.trim() || `student ${plan.StudentId ?? '?'}`;
  const option = plan.TransportationName?.trim() || 'no plan';
  const status = plan.BlockedReason
    ? 'blocked'
    : plan.IsDefault === true
      ? 'default'
      : plan.IsDefault === false
        ? 'changed'
        : 'scheduled';
  const tail = ` — ${date ?? 'no date'} — ${status}`;
  const title = `${who}: ${option}`;
  const room = BRIEF_LINE_MAX - tail.length;
  const shown = title.length > room ? `${title.slice(0, room - 1)}…` : title;
  return `${shown}${tail}`;
}

/**
 * The brief answer: every student's plan for every day in the range, one line
 * each, inside the untrusted-data envelope as `data: string[]` (option names
 * are school-authored). `-- none` for an empty range; `-- N of M shown` when
 * the lines were capped.
 */
export function briefPlansResponse(days: ParentPlanDay[]): CallToolResult {
  const lines = days.flatMap((day) => {
    const date = day.PlanDate ? day.PlanDate.slice(0, 10) : null;
    return (day.Plans ?? []).map((plan) => briefPlanLine(date, plan));
  });
  const shown = lines.slice(0, BRIEF_MAX_LINES);
  if (lines.length === 0) shown.push('-- none');
  else if (lines.length > shown.length) shown.push(`-- ${shown.length} of ${lines.length} shown`);
  const payload = untrustedEnvelope(shown, { note: BRIEF_UNTRUSTED_NOTE });
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function registerPlanTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_list_plans',
    {
      description:
        `Day-by-day dismissal plans across a date range for every student on the account: the option in force, its note, and the weekly default it overrides. Pass raw: true for the untouched API records, or view: "brief" for one line per student per day. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: schoolMeta('whats-on', {
        canonical: true,
        when: { start: 'start_date', end: 'end_date' },
        aliases: DISMISSAL_ALIASES,
      }),
      inputSchema: z.object({
        start_date: IsoDate.describe('YYYY-MM-DD'),
        end_date: IsoDate.describe('YYYY-MM-DD'),
        raw: rawParam,
        view: z
          .enum(['full', 'brief'])
          .optional()
          .describe(
            '"full" (default) is the day-by-day summary; "brief" answers one line per student per day — ' +
              '"<child>: <option> — <YYYY-MM-DD> — <default|changed|blocked|scheduled>" — without plan notes. ' +
              'brief takes precedence over raw.',
          ),
      }),
    },
    async ({ start_date, end_date, raw, view }) => {
      const days = await client.getParentPlans(start_date, end_date);
      if (view === 'brief') return briefPlansResponse(days);
      return untrustedResult(
        { days: raw === true ? days : days.map(summarizeParentPlanDay) },
        PUP_UNTRUSTED,
      );
    },
  );

  server.registerTool(
    'pup_get_plan',
    {
      description:
        `The dismissal plan for one student on one date — the option in force, any note, the early-dismissal time, and whether the date is locked because the cutoff has passed. Pass raw: true for the untouched API record. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: schoolMeta('lookup'),
      inputSchema: z.object({
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        date: IsoDate.describe('YYYY-MM-DD'),
        raw: rawParam,
      }),
    },
    async ({ student_id, date, raw }) => {
      const plan = await client.getPlanEdit(date, student_id);
      // Nested under `plan`, not spread: the projection's own `note` would
      // collide with the envelope's and be pushed down under `data`.
      return untrustedResult(
        { plan: raw === true ? plan : summarizePlanEdit(date, student_id, plan) },
        PUP_UNTRUSTED,
      );
    },
  );

  server.registerTool(
    'pup_set_plan',
    {
      description:
        `Change how a student is dismissed on one or more specific dates, or clear those dates back to the student's weekly default. This changes how a child actually leaves school. ${CONFIRM_FLOW_SENTENCE} The preview shows the exact payload. Read pup_list_transportations first — options differ in whether they require a note, a car number or an early-dismissal time.`,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      _meta: schoolMeta('change', { aliases: DISMISSAL_ALIASES }),
      inputSchema: z.object({
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        dates: z
          .array(z.string())
          .min(1)
          .describe('One or more YYYY-MM-DD dates to apply this plan to'),
        transportation_id: z
          .number()
          .int()
          .nullable()
          .describe(
            "Dismissal option id from pup_list_transportations, or null to clear these dates back to the student's default plan",
          ),
        note: z.string().optional().describe('Note for the school; required by some options'),
        early_dismissal_time: z
          .string()
          .optional()
          .describe('HH:MM, required when the option is an early dismissal'),
        car_number: z
          .string()
          .optional()
          .describe('Car number, for options where usesCarNumbers is true'),
        confirmToken: confirmTokenParam,
      }),
    },
    (async ({ student_id, dates, transportation_id, note, early_dismissal_time, car_number, confirmToken }, ctx) => {
      // The reads below resolve and validate the payload; they mutate nothing.
      // Running them before the confirm gate — on every call, both phases — is
      // deliberate: it makes the preview show the exact bytes that would be
      // sent, already checked against this school's rules, and phase 2 hashes
      // a freshly rebuilt payload, so anything that moved since the preview is
      // refused as DRAFT_CHANGED.
      const student = await client.getStudent(student_id);
      const transportation =
        transportation_id === null
          ? null
          : await resolveTransportation(client, student.SchoolId, transportation_id);

      const plans: PlanUpdate[] = buildPlanUpdates({
        student,
        dates,
        transportation,
        note,
        earlyDismissalTime: early_dismissal_time,
        carNumber: car_number,
      });

      const action =
        transportation === null
          ? `Clear ${dates.length} date(s) back to ${student.FirstName ?? 'the student'}'s default plan`
          : `Set ${dates.length} date(s) for ${student.FirstName ?? 'the student'} to "${transportation.Name}"`;

      const gate = await confirmWrite(ctx, {
        tool: 'pup_set_plan',
        action: 'plans.set',
        summary: action,
        account: client.account(),
        target: String(student_id),
        request: { method: 'PUT', path: `${BASE_PATH}/UpdatePlans`, body: { Plans: plans } },
        preview: { dto: 'UpdatePlans' },
        confirmToken,
      });
      if (gate) return gate;

      await client.updatePlans(plans);

      // A 2xx is not proof the change persisted — re-read each date and
      // compare the fields that prove it (option, note, and the time / car
      // number when sent). ModifiedDate is deliberately not
      // compared: it advances on its own, which would make every write look
      // successful.
      // One expectation for the whole call: every date in a single UpdatePlans
      // gets the same option and note, so this does not vary per date.
      const expected = expectedPlanState({
        transportationId: transportation_id,
        note: plans[0]?.Note ?? null,
        earlyDismissalTime: plans[0]?.EarlyDismissalTime,
        carNumber: plans[0]?.CarNumber,
      });
      const verification = await Promise.all(
        dates.map(async (date) => {
          const after = await client.getPlanEdit(date, student_id);
          const actual: PlanProof = {
            transportationId: after.TransportationId ?? null,
            note: after.Note ?? null,
            earlyDismissalTime: after.EarlyDismissalTime ?? null,
            carNumber: after.CarNumber ?? null,
          };
          return {
            date,
            weekday: weekdayOf(date),
            transportationId: actual.transportationId,
            transportation: after.TransportationName ?? null,
            note: actual.note,
            earlyDismissalTime: after.EarlyDismissalTime ?? null,
            locked: after.IsLocked ?? false,
            verified: proofsMatch(actual, expected),
          };
        }),
      );

      const failed = verification.filter((v) => !v.verified);
      return minifiedResult({
        action,
        applied: verification,
        verified: failed.length === 0,
        ...(failed.length > 0
          ? {
              warning:
                'PickUp Patrol accepted the request but these dates did not change — they are usually past the school cutoff, or the date is not a school day.',
              unchanged: failed.map((v) => v.date),
            }
          : {}),
      });
    }),
  );
}
