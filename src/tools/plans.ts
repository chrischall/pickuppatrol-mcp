import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolError, textResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { buildPlanUpdates } from '../plans.js';
import { weekdayOf } from '../dates.js';
import type { PlanUpdate, Transportation } from '../types.js';
import { previewUnlessConfirmed, schemaConfirm } from './_confirm.js';
import { withHints } from './_errors.js';

/** The fields whose change proves a plan write actually landed. */
export interface PlanProof {
  transportationId: number | null;
  note: string | null;
}

/** Compare two proofs, ignoring whitespace the service may normalise off a note. */
export function proofsMatch(a: PlanProof, b: PlanProof): boolean {
  return a.transportationId === b.transportationId && (a.note ?? '').trim() === (b.note ?? '').trim();
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
      inputSchema: {
        start_date: z.string().describe('YYYY-MM-DD'),
        end_date: z.string().describe('YYYY-MM-DD'),
      },
    },
    async ({ start_date, end_date }) =>
      textResult(await client.getParentPlans(start_date, end_date)),
  );

  server.registerTool(
    'pup_get_plan',
    {
      description:
        'The dismissal plan for one student on one date — the option in force, any note, the early-dismissal time, and whether the date is locked because the cutoff has passed.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        date: z.string().describe('YYYY-MM-DD'),
      },
    },
    async ({ student_id, date }) => textResult(await client.getPlanEdit(date, student_id)),
  );

  server.registerTool(
    'pup_set_plan',
    {
      description:
        "Change how a student is dismissed on one or more specific dates, or clear those dates back to the student's weekly default. This changes how a child actually leaves school, so it requires confirm: true; without it you get a dry-run of the exact payload. Read pup_list_transportations first — options differ in whether they require a note, a car number or an early-dismissal time.",
      inputSchema: {
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
        confirm: schemaConfirm,
      },
    },
    withHints(async ({ student_id, dates, transportation_id, note, early_dismissal_time, car_number, confirm }) => {
      // The reads below resolve and validate the payload; they mutate nothing.
      // Running them before the confirm gate is deliberate: it makes the
      // dry-run show the exact bytes that would be sent, already checked
      // against this school's rules, instead of an unvalidated echo of the
      // arguments.
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

      const gate = previewUnlessConfirmed(confirm, action, 'PUT', 'UpdatePlans', { Plans: plans });
      if (gate) return gate;

      await client.updatePlans(plans);

      // A 2xx is not proof the change persisted — re-read each date and
      // compare the one field that proves it. ModifiedDate is deliberately not
      // compared: it advances on its own, which would make every write look
      // successful.
      const requestedState: PlanProof = {
        transportationId: transportation_id,
        note: plans[0]?.Note ?? null,
      };
      const verification = await Promise.all(
        dates.map(async (date) => {
          const after = await client.getPlanEdit(date, student_id);
          const expected = expectedPlanState(requestedState);
          const actual: PlanProof = {
            transportationId: after.TransportationId ?? null,
            note: after.Note ?? null,
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
      return textResult({
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
