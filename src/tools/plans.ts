import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { McpToolError, minifiedResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { buildPlanUpdates } from '../plans.js';
import { weekdayOf } from '../dates.js';
import type { PlanUpdate, Transportation } from '../types.js';
import { CONFIRM_FLOW, confirmTokenParam, confirmWrite } from './_confirm.js';

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

export function registerPlanTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_list_plans',
    {
      description:
        'Day-by-day dismissal plans across a date range for every student on the account, as PickUp Patrol returns them.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        start_date: z.string().describe('YYYY-MM-DD'),
        end_date: z.string().describe('YYYY-MM-DD'),
      }),
    },
    async ({ start_date, end_date }) =>
      minifiedResult(await client.getParentPlans(start_date, end_date)),
  );

  server.registerTool(
    'pup_get_plan',
    {
      description:
        'The dismissal plan for one student on one date — the option in force, any note, the early-dismissal time, and whether the date is locked because the cutoff has passed.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        date: z.string().describe('YYYY-MM-DD'),
      }),
    },
    async ({ student_id, date }) => minifiedResult(await client.getPlanEdit(date, student_id)),
  );

  server.registerTool(
    'pup_set_plan',
    {
      description:
        `Change how a student is dismissed on one or more specific dates, or clear those dates back to the student's weekly default. This changes how a child actually leaves school. ${CONFIRM_FLOW} The preview shows the exact payload. Read pup_list_transportations first — options differ in whether they require a note, a car number or an early-dismissal time.`,
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
        method: 'PUT',
        dto: 'UpdatePlans',
        target: String(student_id),
        payload: { Plans: plans },
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
