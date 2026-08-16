import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, messageOf } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { dayIdToName } from '../dates.js';
import type { DefaultPlan, Student } from '../types.js';
import { VERSION } from '../version.js';

/** Project a student down to the fields a parent actually asks about. */
export function summarizeStudent(student: Student): Record<string, unknown> {
  return {
    studentId: student.StudentId,
    firstName: student.FirstName,
    lastName: student.LastName,
    schoolId: student.SchoolId,
    schoolName: student.SchoolName,
    allowPlans: student.AllowPlans ?? null,
    defaultCarNumber: student.DefaultCarNumber ?? null,
    defaultsReviewedDate: student.DefaultsReviewedDate ?? null,
    defaultPlans: summarizeDefaultPlans(student.DefaultPlans),
  };
}

/** Order the weekly defaults Sunday→Saturday and label each day. */
export function summarizeDefaultPlans(plans: DefaultPlan[] | null | undefined): unknown[] {
  return [...(plans ?? [])]
    .sort((a, b) => a.DayId - b.DayId)
    .map((plan) => ({
      dayId: plan.DayId,
      weekday: plan.WeekDayName ?? dayIdToName(plan.DayId),
      transportationId: plan.TransportationId ?? null,
      transportation: plan.TransportationName ?? null,
      note: plan.Note ?? null,
      earlyDismissalTime: plan.EarlyDismissalTime ?? null,
      carNumber: plan.UseCarNumbers ? (plan.CarNumber ?? null) : null,
    }));
}

export function registerAccountTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_get_session',
    {
      description:
        'The signed-in PickUp Patrol parent account: name, email, last sign-in, and the students linked to it. Start here to discover student and school ids.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const session = await client.getSession();
      return textResult({
        userId: session.UserId ?? null,
        name: session.DisplayName ?? [session.FirstName, session.LastName].filter(Boolean).join(' '),
        email: session.Email ?? session.PrimaryEmail ?? null,
        lastLoginDate: session.LastLoginDate ?? null,
        sendPlanConfirmEmails: session.SendPlanConfirmEmails ?? null,
        hasAcceptedLatestTerms: session.HasAcceptedLatestTerms ?? null,
        children: session.Children ?? [],
      });
    },
  );

  server.registerTool(
    'pup_list_students',
    {
      description:
        'Every student on the account, each with their weekly default dismissal plan and whether those defaults still need a parent review.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [students, review] = await Promise.all([
        client.getChildren(),
        client.getDefaultPlansReviewNeeded(),
      ]);
      const needsReview = new Map(review.map((r) => [r.StudentId, r.NeedsReview]));
      return textResult(
        students.map((student) => ({
          ...summarizeStudent(student),
          needsDefaultsReview: needsReview.get(student.StudentId) ?? false,
        })),
      );
    },
  );

  server.registerTool(
    'pup_get_student',
    {
      description:
        'One student in full, including the default dismissal plan for each weekday. Pass raw: true for the untouched API record.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        raw: z
          .boolean()
          .optional()
          .describe('Return the unprojected API record instead of the summary'),
      },
    },
    async ({ student_id, raw }) => {
      const student = await client.getStudent(student_id);
      return textResult(raw === true ? student : summarizeStudent(student));
    },
  );

  server.registerTool(
    'pup_healthcheck',
    {
      description:
        'Verify the configured credentials sign in and the PickUp Patrol API answers. Reports the server version and the students the account can see.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const session = await client.getSession();
        return textResult({
          ok: true,
          version: VERSION,
          signedInAs: session.Email ?? session.PrimaryEmail ?? session.DisplayName ?? null,
          studentCount: session.Children?.length ?? 0,
        });
      } catch (err) {
        // A healthcheck reports rather than throws: the whole point is to say
        // what is wrong, and an exception here reads to the host as the tool
        // itself being broken.
        return textResult({ ok: false, version: VERSION, error: messageOf(err) });
      }
    },
  );
}
