import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { minifiedResult, UNTRUSTED_DESCRIPTION_SUFFIX, untrustedResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import { WEEKDAY_NAMES } from '../dates.js';
import type {
  School,
  SchoolNoteSetting,
  SchoolNotifyTimes,
  SchoolSettings,
  Transportation,
} from '../types.js';
import { PUP_UNTRUSTED } from './untrusted.js';

/**
 * Project a transportation to its identity plus the rules that decide what a
 * plan using it must carry — an agent choosing an option needs those rules up
 * front, not after a rejected write.
 */
export function summarizeTransportation(option: Transportation): Record<string, unknown> {
  return {
    transportationId: option.TransportationId,
    name: option.Name,
    noteRequired: option.IsNoteRequired ?? false,
    noteHint: option.NoteHint ?? null,
    usesCarNumbers: option.UseCarNumbers ?? false,
    isEarlyDismissal: option.IsEarlyDismissal ?? false,
    isLimited: option.IsLimited ?? false,
    cutoffTime: option.CutoffTime ?? null,
    active: option.IsActive ?? true,
  };
}

/** Project a `GetSchool` record to the profile a parent needs. */
export function summarizeSchool(school: School): Record<string, unknown> {
  return {
    schoolId: school.SchoolId,
    name: school.Name ?? null,
    active: school.IsActive ?? null,
    timeZone: school.TimeZoneId ?? null,
    helpPhone: school.HelpPhone ?? null,
    helpEmail: school.HelpEmail ?? null,
    busRouteUrl: school.BusRouteUrl ?? null,
    allowPlans: school.AllowPlans ?? null,
    allowDefaultPlans: school.AllowDefaultPlans ?? null,
  };
}

/**
 * Turn `GetSchoolNotifyTimes`' fourteen `NotifyTime<Day>` / `CutoffTime<Day>`
 * fields into one row per weekday, Sunday first. A day with no notify time is
 * not a school day (docs/PICKUPPATROL-API.md).
 */
export function summarizeNotifyTimes(times: SchoolNotifyTimes): Array<Record<string, unknown>> {
  return WEEKDAY_NAMES.map((weekday) => {
    const notifyTime = (times[`NotifyTime${weekday}`] as string | null | undefined) ?? null;
    const cutoffTime = (times[`CutoffTime${weekday}`] as string | null | undefined) ?? null;
    return { weekday, schoolDay: notifyTime !== null, notifyTime, cutoffTime };
  });
}

function summarizeNoteSetting(setting: SchoolNoteSetting | null | undefined): Record<string, unknown> {
  return {
    noteRequired: setting?.NoteRequired ?? false,
    noteHint: setting?.NoteHint ?? null,
  };
}

/**
 * Project `GetSchoolSettings` to the fields the parents' SPA is seen reading:
 * whether default plans are allowed, and the note rules for a late arrival and
 * a leave-and-return. Free-text blocks (e.g. `Welcome`) stay behind `raw`.
 */
export function summarizeSchoolSettings(settings: SchoolSettings): Record<string, unknown> {
  return {
    allowDefaultPlans: settings.General?.AllowDefaultPlans ?? null,
    lateArrival: summarizeNoteSetting(settings.LateArrival),
    leaveAndReturn: summarizeNoteSetting(settings.LeaveAndReturn),
  };
}

export function registerSchoolTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_list_transportations',
    {
      description:
        `The dismissal options a school offers (bus, car pickup, walker, absent …) with the rules each one imposes: whether a note is required, whether it takes a car number, whether it is an early dismissal, and the daily cutoff time. Read this before setting a plan. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        school_id: z.number().int().describe('School id, from pup_list_students'),
        include_inactive: z
          .boolean()
          .optional()
          .describe('Include options the school has deactivated (default false)'),
      }),
    },
    async ({ school_id, include_inactive }) => {
      const options = await client.getTransportations(school_id);
      const visible = include_inactive === true ? options : options.filter((o) => o.IsActive !== false);
      return untrustedResult({ options: visible.map(summarizeTransportation) }, PUP_UNTRUSTED);
    },
  );

  server.registerTool(
    'pup_get_school',
    {
      description:
        `A school profile together with its per-weekday notify times and plan cutoff times, and the settings that decide whether parents may set plans at all. Pass raw: true for the untouched API records. ${UNTRUSTED_DESCRIPTION_SUFFIX}`,
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        school_id: z.number().int().describe('School id, from pup_list_students'),
        raw: z
          .boolean()
          .optional()
          .describe('Return the unprojected API records instead of the summary (still marked untrusted)'),
      }),
    },
    async ({ school_id, raw }) => {
      const [school, notifyTimes, settings] = await Promise.all([
        client.getSchool(school_id),
        client.getSchoolNotifyTimes(school_id),
        client.getSchoolSettings(school_id),
      ]);
      if (raw === true) return untrustedResult({ school, notifyTimes, settings }, PUP_UNTRUSTED);
      return untrustedResult(
        {
          school: summarizeSchool(school),
          weekdays: summarizeNotifyTimes(notifyTimes),
          settings: summarizeSchoolSettings(settings),
        },
        PUP_UNTRUSTED,
      );
    },
  );

  server.registerTool(
    'pup_list_non_school_days',
    {
      description:
        'Dates a plan cannot be set for at a school (holidays, closures, weekends), and optionally the dates in a range that already differ from the student defaults.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        school_id: z.number().int().describe('School id, from pup_list_students'),
        start_date: z
          .string()
          .optional()
          .describe('YYYY-MM-DD; with end_date, also return dates that differ from the default'),
        end_date: z.string().optional().describe('YYYY-MM-DD'),
      }),
    },
    async ({ school_id, start_date, end_date }) => {
      const invalidDates = await client.getInvalidPlanDates(school_id);
      if (start_date === undefined || end_date === undefined) {
        return minifiedResult({ invalidDates });
      }
      const changedDates = await client.getBoldedDates(start_date, end_date);
      return minifiedResult({ invalidDates, changedDates });
    },
  );

  server.registerTool(
    'pup_list_car_numbers',
    {
      description:
        'The car numbers a school has issued to this account, for dismissal options where usesCarNumbers is true.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        school_id: z.number().int().describe('School id, from pup_list_students'),
      }),
    },
    async ({ school_id }) => minifiedResult(await client.getCarNumbers(school_id)),
  );
}
