import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolError, textResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { buildPlanUpdates } from '../plans.js';
import { dateToDayId, weekdayOf } from '../dates.js';
import type { PlanUpdate, Student, Transportation } from '../types.js';
import { previewUnlessConfirmed, schemaConfirm } from './_confirm.js';
import { withHints } from './_errors.js';

/**
 * The transportation id a date should show once a write has landed.
 *
 * For a normal change that is the id we asked for. For a revert
 * (`TransportationId: null`) the date falls back to the student's default for
 * that weekday, so the id to expect is that default's — and when the student
 * has no default for the day there is nothing to assert, hence `undefined`.
 */
export function expectedTransportationId(
  student: Student,
  planDate: string,
  requested: number | null,
): number | null | undefined {
  if (requested !== null) return requested;
  const dayId = dateToDayId(planDate);
  if (dayId === null) return undefined;
  const fallback = (student.DefaultPlans ?? []).find((plan) => plan.DayId === dayId);
  return fallback === undefined ? undefined : (fallback.TransportationId ?? null);
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
      const verification = await Promise.all(
        dates.map(async (date) => {
          const after = await client.getPlanEdit(date, student_id);
          const expected = expectedTransportationId(student, date, transportation_id);
          const actual = after.TransportationId ?? null;
          return {
            date,
            weekday: weekdayOf(date),
            transportationId: actual,
            transportation: after.TransportationName ?? null,
            note: after.Note ?? null,
            earlyDismissalTime: after.EarlyDismissalTime ?? null,
            locked: after.IsLocked ?? false,
            verified: expected === undefined ? null : actual === expected,
          };
        }),
      );

      const failed = verification.filter((v) => v.verified === false);
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
