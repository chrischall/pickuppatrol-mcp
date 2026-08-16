import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult } from '@chrischall/mcp-utils';
import type { PickUpPatrolClient } from '../client.js';
import type { Transportation } from '../types.js';

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

export function registerSchoolTools(server: McpServer, client: PickUpPatrolClient): void {
  server.registerTool(
    'pup_list_transportations',
    {
      description:
        'The dismissal options a school offers (bus, car pickup, walker, absent …) with the rules each one imposes: whether a note is required, whether it takes a car number, whether it is an early dismissal, and the daily cutoff time. Read this before setting a plan.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        school_id: z.number().int().describe('School id, from pup_list_students'),
        include_inactive: z
          .boolean()
          .optional()
          .describe('Include options the school has deactivated (default false)'),
      },
    },
    async ({ school_id, include_inactive }) => {
      const options = await client.getTransportations(school_id);
      const visible = include_inactive === true ? options : options.filter((o) => o.IsActive !== false);
      return textResult(visible.map(summarizeTransportation));
    },
  );

  server.registerTool(
    'pup_get_school',
    {
      description:
        'A school profile together with its per-weekday notify times and plan cutoff times, and the settings that decide whether parents may set plans at all.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        school_id: z.number().int().describe('School id, from pup_list_students'),
      },
    },
    async ({ school_id }) => {
      const [school, notifyTimes, settings] = await Promise.all([
        client.getSchool(school_id),
        client.getSchoolNotifyTimes(school_id),
        client.getSchoolSettings(school_id),
      ]);
      return textResult({ school, notifyTimes, settings });
    },
  );

  server.registerTool(
    'pup_list_non_school_days',
    {
      description:
        'Dates a plan cannot be set for at a school (holidays, closures, weekends), and optionally the dates in a range that already differ from the student defaults.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        school_id: z.number().int().describe('School id, from pup_list_students'),
        start_date: z
          .string()
          .optional()
          .describe('YYYY-MM-DD; with end_date, also return dates that differ from the default'),
        end_date: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    async ({ school_id, start_date, end_date }) => {
      const invalidDates = await client.getInvalidPlanDates(school_id);
      if (start_date === undefined || end_date === undefined) {
        return textResult({ invalidDates });
      }
      const changedDates = await client.getBoldedDates(start_date, end_date);
      return textResult({ invalidDates, changedDates });
    },
  );

  server.registerTool(
    'pup_list_car_numbers',
    {
      description:
        'The car numbers a school has issued to this account, for dismissal options where usesCarNumbers is true.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        school_id: z.number().int().describe('School id, from pup_list_students'),
      },
    },
    async ({ school_id }) => textResult(await client.getCarNumbers(school_id)),
  );
}
