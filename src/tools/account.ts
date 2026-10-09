import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { minifiedResult, UNTRUSTED_DESCRIPTION_SUFFIX, untrustedResult } from '@chrischall/mcp-utils';
import { runCredentialHealthcheck } from '@chrischall/mcp-utils/healthcheck';
import { SignInRejectedError, UnusableSessionError } from '../auth.js';
import type { PickUpPatrolClient } from '../client.js';
import { dayIdToName } from '../dates.js';
import type { DefaultPlan, SessionResponse, Student } from '../types.js';
import { VERSION } from '../version.js';
import { PUP_UNTRUSTED } from './untrusted.js';

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
      return minifiedResult({
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
        `Every student on the account, each with their weekly default dismissal plan and whether those defaults still need a parent review. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [students, review] = await Promise.all([
        client.getChildren(),
        client.getDefaultPlansReviewNeeded(),
      ]);
      const needsReview = new Map(review.map((r) => [r.StudentId, r.NeedsReview]));
      return untrustedResult(
        {
          students: students.map((student) => ({
            ...summarizeStudent(student),
            needsDefaultsReview: needsReview.get(student.StudentId) ?? false,
          })),
        },
        PUP_UNTRUSTED,
      );
    },
  );

  server.registerTool(
    'pup_get_student',
    {
      description:
        `One student in full, including the default dismissal plan for each weekday. Pass raw: true for the untouched API record. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        student_id: z.number().int().describe('Student id, from pup_list_students'),
        raw: z
          .boolean()
          .optional()
          .describe('Return the unprojected API record instead of the summary'),
      }),
    },
    async ({ student_id, raw }) => {
      const student = await client.getStudent(student_id);
      return untrustedResult(raw === true ? student : summarizeStudent(student), PUP_UNTRUSTED);
    },
  );

  server.registerTool(
    'pup_healthcheck',
    {
      description:
        "Verify the configured credentials sign in and the PickUp Patrol API answers. Reports the server version, the students the account can see, and — when it fails — an error.kind saying which hop broke: no_credential (nothing configured), credential_rejected (PickUp Patrol refused the username/password), verification_pending (a two-factor account), edge_blocked (a CDN/WAF refused the request before PickUp Patrol saw it, so the credentials were never judged), timeout, transport or http. Read-only; never returns the credentials.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      let session: SessionResponse | undefined;
      // A healthcheck reports rather than throws: the whole point is to say
      // what is wrong, and an exception here reads to the host as the tool
      // itself being broken. The shared ladder supplies the `kind`
      // (chrischall/mcp-host#1015); the account facts ride beside it.
      const shared = await runCredentialHealthcheck({
        server,
        prefix: 'pup',
        hostLabel: 'app.pickuppatrol.net',
        probePath: '/api/json/reply/GetSession',
        resolveCredential: async () => ({ source: client.credentialSource() }),
        probeFn: async () => {
          session = await client.getSession();
        },
        classifyThrown: classifyPupError,
      });
      const result = JSON.parse(shared.content[0]!.text) as Record<string, unknown>;
      return minifiedResult({
        ...result,
        version: VERSION,
        ...(session !== undefined
          ? {
              signedInAs: session.Email ?? session.PrimaryEmail ?? session.DisplayName ?? null,
              studentCount: session.Children?.length ?? 0,
            }
          : {}),
      });
    },
  );
}

/**
 * Name the PickUp Patrol failures the shared status ladder cannot see: its
 * sign-in rejection and two-factor errors carry no HTTP status. Anything else
 * (an edge block, a timeout, a 5xx) falls through to the shared ladder.
 */
export function classifyPupError(err: unknown): { kind: string; hint?: string } | undefined {
  if (err instanceof SignInRejectedError) return { kind: 'credential_rejected', hint: err.hint };
  if (err instanceof UnusableSessionError) return { kind: 'verification_pending', hint: err.hint };
  return undefined;
}
