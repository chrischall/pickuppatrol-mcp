import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpToolError, textResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { applyDefaultPlans, clearDefaultPlans } from '../plans.js';
import { dayIdToName, nameToDayId } from '../dates.js';
import { summarizeDefaultPlans } from './account.js';
import { resolveTransportation } from './plans.js';
import { previewUnlessConfirmed, schemaConfirm } from './_confirm.js';
import { withHints } from './_errors.js';

/**
 * Accept weekdays as names ("Monday") or ids (1 = Sunday … 7 = Saturday).
 * A name that is not a weekday is rejected rather than coerced — silently
 * landing on Sunday would be a plan change nobody asked for.
 */
export function parseWeekdays(days: Array<string | number>): number[] {
  return days.map((day) => {
    if (typeof day === 'number') {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw new McpToolError(`${day} is not a weekday id (1 = Sunday … 7 = Saturday)`);
      }
      return day;
    }
    const asNumber = /^[1-7]$/.test(day.trim()) ? Number(day.trim()) : null;
    if (asNumber !== null) return asNumber;
    const dayId = nameToDayId(day);
    if (dayId === null) {
      throw new McpToolError(`"${day}" is not a weekday`, {
        hint: 'Use a name like "Monday", or an id 1–7 where 1 is Sunday.',
      });
    }
    return dayId;
  });
}

export function registerDefaultPlanTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_get_default_plans',
    {
      description:
        "A student's weekly default dismissal plan — how they normally leave school on each day of the week — and whether the defaults still need a parent review.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        student_id: z.number().int().describe('Student id, from pup_list_students'),
      },
    },
    async ({ student_id }) => {
      const [student, review] = await Promise.all([
        client.getStudent(student_id),
        client.getDefaultPlansReviewNeeded(),
      ]);
      return textResult({
        studentId: student.StudentId,
        name: [student.FirstName, student.LastName].filter(Boolean).join(' '),
        schoolId: student.SchoolId,
        schoolName: student.SchoolName,
        allowPlans: student.AllowPlans ?? null,
        defaultsReviewedDate: student.DefaultsReviewedDate ?? null,
        needsDefaultsReview:
          review.find((r) => r.StudentId === student_id)?.NeedsReview ?? false,
        defaultPlans: summarizeDefaultPlans(student.DefaultPlans),
      });
    },
  );

  server.registerTool(
    'pup_set_default_plans',
    {
      description:
        "Change a student's weekly default dismissal plan for one or more weekdays, or clear every default. This is how the child leaves school on any date without a specific plan, so it requires confirm: true; without it you get a dry-run. Read pup_list_transportations first.",
      inputSchema: {
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        days: z
          .array(z.union([z.string(), z.number().int()]))
          .optional()
          .describe('Weekdays to change, as names ("Monday") or ids (1 = Sunday … 7 = Saturday)'),
        transportation_id: z
          .number()
          .int()
          .optional()
          .describe('Dismissal option id from pup_list_transportations'),
        note: z.string().optional().describe('Note for the school; required by some options'),
        early_dismissal_time: z
          .string()
          .optional()
          .describe('HH:MM, required when the option is an early dismissal'),
        clear_all: z
          .boolean()
          .optional()
          .describe('Remove every weekday default instead of setting one (days is ignored)'),
        confirm: schemaConfirm,
      },
    },
    withHints(async ({ student_id, days, transportation_id, note, early_dismissal_time, clear_all, confirm }) => {
      // Read-modify-write: PickUp Patrol has no default-plans endpoint, so the
      // whole student record round-trips. Reading it here (before the confirm
      // gate) is what makes the dry-run show the real payload; it mutates
      // nothing.
      const student = await client.getStudent(student_id);

      if (clear_all === true) {
        const payload = clearDefaultPlans(student);
        const gate = previewUnlessConfirmed(
          confirm,
          `Clear every weekday default for ${student.FirstName ?? 'the student'}`,
          'PUT',
          'Student',
          { StudentId: student.StudentId, DefaultPlans: [] },
        );
        if (gate) return gate;
        await client.updateStudent(payload);
        const after = await client.getStudent(student_id);
        const remaining = after.DefaultPlans ?? [];
        return textResult({
          action: 'Cleared every weekday default',
          defaultPlans: summarizeDefaultPlans(remaining),
          verified: remaining.length === 0,
          ...(remaining.length > 0
            ? { warning: 'PickUp Patrol accepted the request but defaults are still set.' }
            : {}),
        });
      }

      if (days === undefined || transportation_id === undefined) {
        throw new McpToolError('days and transportation_id are both required', {
          hint: 'Pass clear_all: true to remove every default instead.',
        });
      }

      const dayIds = parseWeekdays(days);
      const transportation = await resolveTransportation(
        client,
        student.SchoolId,
        transportation_id,
      );
      const payload = applyDefaultPlans({
        student,
        dayIds,
        transportation,
        note,
        earlyDismissalTime: early_dismissal_time,
      });

      const dayNames = dayIds.map((id) => dayIdToName(id)).join(', ');
      const action = `Set ${student.FirstName ?? 'the student'}'s default plan on ${dayNames} to "${transportation.Name}"`;

      const gate = previewUnlessConfirmed(confirm, action, 'PUT', 'Student', {
        StudentId: student.StudentId,
        DefaultPlans: payload.DefaultPlans,
        note: 'The whole student record is sent back with only DefaultPlans changed.',
      });
      if (gate) return gate;

      await client.updateStudent(payload);

      // Re-read and check the weekdays we changed actually hold the new
      // option. DefaultsModifiedDate is not compared — it advances by itself.
      const after = await client.getStudent(student_id);
      const changed = new Set(dayIds);
      const unchanged = [...changed].filter((dayId) => {
        const plan = (after.DefaultPlans ?? []).find((p) => p.DayId === dayId);
        return plan?.TransportationId !== transportation.TransportationId;
      });

      return textResult({
        action,
        defaultPlans: summarizeDefaultPlans(after.DefaultPlans),
        verified: unchanged.length === 0,
        ...(unchanged.length > 0
          ? {
              warning:
                'PickUp Patrol accepted the request but these weekdays did not change — the school may not run default plans on them.',
              unchanged: unchanged.map((id) => dayIdToName(id)),
            }
          : {}),
      });
    }),
  );

  server.registerTool(
    'pup_mark_defaults_reviewed',
    {
      description:
        "Mark a student's default plans as reviewed, clearing the school's 'needs review' prompt. Requires confirm: true.",
      inputSchema: {
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        reviewed: z.boolean().optional().describe('Defaults to true'),
        confirm: schemaConfirm,
      },
    },
    async ({ student_id, reviewed, confirm }) => {
      const value = reviewed ?? true;
      const gate = previewUnlessConfirmed(
        confirm,
        `Mark student ${student_id}'s defaults as ${value ? 'reviewed' : 'not reviewed'}`,
        'PUT',
        'SetDefaultsReviewed',
        { StudentId: student_id, Reviewed: value },
      );
      if (gate) return gate;

      await client.setDefaultsReviewed(student_id, value);
      const review = await client.getDefaultPlansReviewNeeded();
      const needsReview = review.find((r) => r.StudentId === student_id)?.NeedsReview ?? false;
      return textResult({
        studentId: student_id,
        needsDefaultsReview: needsReview,
        verified: needsReview === !value,
      });
    },
  );
}
