import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAccountTools } from '../src/tools/account.js';
import { registerSchoolTools } from '../src/tools/school.js';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { BRIEF_MAX_LINES } from '../src/tools/plans.js';
import type { ParentPlanDay } from '../src/types.js';
import { makeClient } from './helpers.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * asserted against the SERVED tool list — what a host actually reads.
 */
const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  pup_get_session: 'lookup',
  pup_list_students: 'lookup',
  pup_get_student: 'lookup',
  pup_list_transportations: 'lookup',
  pup_get_school: 'lookup',
  pup_list_non_school_days: 'lookup',
  pup_list_car_numbers: 'lookup',
  pup_list_plans: 'whats-on',
  pup_get_plan: 'lookup',
  pup_set_plan: 'change',
  pup_get_default_plans: 'lookup',
  pup_set_default_plans: 'change',
  pup_mark_defaults_reviewed: 'change',
};

interface WireTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema?: { properties?: Record<string, { enum?: unknown[] }> };
  _meta?: Record<string, unknown>;
}

type Mint = {
  domain?: string;
  intent?: string;
  canonical?: boolean;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
};

async function harness(client = makeClient()) {
  return createTestHarness((s: McpServer) => {
    registerAccountTools(s, client);
    registerSchoolTools(s, client);
    registerPlanTools(s, client);
    registerDefaultPlanTools(s, client);
  });
}

async function servedTools(): Promise<WireTool[]> {
  const h = await harness();
  const { tools } = (await h.client.listTools()) as { tools: WireTool[] };
  await h.close();
  return tools;
}

const mintOf = (t: WireTool) => t._meta?.mint as Mint | undefined;

describe('_meta.mint on tools/list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await servedTools()).map((t) => t.name).sort();
    expect(names).toEqual([...Object.keys(EXPECTED_INTENT), 'pup_healthcheck'].sort());
  });

  it('carries no hint on the healthcheck (it joins no group)', async () => {
    const hc = (await servedTools()).find((t) => t.name === 'pup_healthcheck')!;
    expect(mintOf(hc)).toBeUndefined();
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain school and intent %s', async (name, intent) => {
    const tool = (await servedTools()).find((t) => t.name === name)!;
    expect(mintOf(tool)?.domain).toBe('school');
    expect(mintOf(tool)?.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', async () => {
    for (const tool of await servedTools()) {
      const mint = mintOf(tool);
      if (tool.name === 'pup_healthcheck') continue;
      expect(mint, tool.name).toBeDefined();
      const m = mint!;
      expect(Object.keys(m).filter((k) => !KEYS.includes(k)), tool.name).toEqual([]);
      expect(DOMAINS, tool.name).toContain(m.domain);
      expect(INTENTS, tool.name).toContain(m.intent);
      const props = tool.inputSchema?.properties ?? {};
      if ('canonical' in m) {
        expect(m.canonical, tool.name).toBe(true);
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(CANONICAL_INTENTS, tool.name).toContain(m.intent);
        expect(props, tool.name).toHaveProperty('view');
      }
      if ('subject' in m) expect(props, tool.name).toHaveProperty(m.subject!);
      if ('when' in m) {
        expect(Object.keys(m.when!).sort(), tool.name).toEqual(['end', 'start']);
        expect(props, tool.name).toHaveProperty(m.when!.start);
        expect(props, tool.name).toHaveProperty(m.when!.end);
      }
      if ('aliases' in m) {
        expect(m.aliases!.length, tool.name).toBeLessThanOrEqual(8);
        for (const a of m.aliases!) {
          expect(a.length, tool.name).toBeLessThanOrEqual(40);
          expect(a, tool.name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('marks exactly one canonical read: the plans list, for whats-on', async () => {
    const canonical = (await servedTools())
      .filter((t) => mintOf(t)?.canonical === true)
      .map((t) => [t.name, mintOf(t)!.intent]);
    expect(canonical).toEqual([['pup_list_plans', 'whats-on']]);
    // At most one canonical per intent, and never on a write.
    const intents = canonical.map(([, i]) => i);
    expect(new Set(intents).size).toBe(intents.length);
  });

  it('the plans list names its range and takes no subject (it already answers every student)', async () => {
    const tool = (await servedTools()).find((t) => t.name === 'pup_list_plans')!;
    expect(mintOf(tool)).toEqual({
      domain: 'school',
      intent: 'whats-on',
      canonical: true,
      when: { start: 'start_date', end: 'end_date' },
      aliases: ['pickup', 'dismissal', 'carpool', 'bus', 'going home', 'after school', 'school pickup'],
    });
    expect(tool.inputSchema?.properties?.view?.enum).toEqual(['full', 'brief']);
  });
});

/** Parse a brief answer: the untrusted-data envelope with `data: string[]`. */
async function brief(days: ParentPlanDay[]) {
  const client = makeClient({ getParentPlans: async () => days });
  const h = await harness(client);
  const res = (await h.client.callTool({
    name: 'pup_list_plans',
    arguments: { start_date: '2026-11-02', end_date: '2026-11-06', view: 'brief' },
  })) as { content: { type: string; text: string }[] };
  await h.close();
  expect(res.content).toHaveLength(1);
  return JSON.parse(res.content[0]!.text) as { untrusted_content: boolean; note: string; data: string[] };
}

describe('pup_list_plans view: brief', () => {
  it('answers one line per student per day inside the untrusted envelope', async () => {
    const out = await brief([
      {
        PlanDate: '2026-11-02T00:00:00',
        Plans: [
          { StudentId: 1, FirstName: 'Alex', TransportationName: 'Bus', IsDefault: true },
          { StudentId: 2, FirstName: 'Sam', TransportationName: 'Car pickup', IsDefault: false, Note: 'guardian note' },
        ],
      },
      {
        PlanDate: '2026-11-03',
        Plans: [{ StudentId: 1, FirstName: 'Alex', TransportationName: 'Walker', BlockedReason: 'Past cutoff' }],
      },
    ]);
    expect(out.untrusted_content).toBe(true);
    expect(out.note).toMatch(/school staff/);
    expect(out.data).toEqual([
      'Alex: Bus — 2026-11-02 — default',
      'Sam: Car pickup — 2026-11-02 — changed',
      'Alex: Walker — 2026-11-03 — blocked',
    ]);
    // A guardian's free-text note never rides a brief line.
    expect(out.data.join('\n')).not.toContain('guardian note');
  });

  it('says what it does not know rather than guessing', async () => {
    const out = await brief([
      { PlanDate: null, Plans: [{ StudentId: 9 }, { FirstName: '  ' }] },
      { PlanDate: '2026-11-04' },
    ]);
    expect(out.data).toEqual([
      'student 9: no plan — no date — scheduled',
      'student ?: no plan — no date — scheduled',
    ]);
  });

  it('answers "-- none" for an empty range', async () => {
    expect((await brief([])).data).toEqual(['-- none']);
  });

  it('keeps every line within 120 characters', async () => {
    const out = await brief([
      { PlanDate: '2026-11-02', Plans: [{ FirstName: 'A'.repeat(60), TransportationName: 'B'.repeat(90), IsDefault: true }] },
    ]);
    expect(out.data).toHaveLength(1);
    expect(out.data[0]!.length).toBeLessThanOrEqual(120);
    expect(out.data[0]).toMatch(/… — 2026-11-02 — default$/);
  });

  it('escapes a title that would read as a note or starts with a backslash', async () => {
    const out = await brief([
      {
        PlanDate: '2026-11-02',
        Plans: [
          { FirstName: '-- none', TransportationName: 'Bus', IsDefault: true },
          { FirstName: '\\Sam', TransportationName: 'Walker', IsDefault: false },
          { FirstName: '--Kim', TransportationName: 'Car', IsDefault: true },
        ],
      },
    ]);
    expect(out.data).toEqual([
      '\\-- none: Bus — 2026-11-02 — default',
      '\\\\Sam: Walker — 2026-11-02 — changed',
      '--Kim: Car — 2026-11-02 — default',
    ]);
  });

  it('keeps an escaped long title within 120 characters', async () => {
    const out = await brief([
      { PlanDate: '2026-11-02', Plans: [{ FirstName: '-- ' + 'A'.repeat(120), TransportationName: 'Bus', IsDefault: true }] },
    ]);
    expect(out.data[0]!.length).toBeLessThanOrEqual(120);
    expect(out.data[0]!.startsWith('\\-- AAA')).toBe(true);
  });

  it('caps the lines and says so with an "-- N of M shown" note', async () => {
    const total = BRIEF_MAX_LINES + 5;
    const days: ParentPlanDay[] = Array.from({ length: total }, (_, i) => ({
      PlanDate: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
      Plans: [{ FirstName: `Kid${i}`, TransportationName: 'Bus', IsDefault: true }],
    }));
    const out = await brief(days);
    expect(out.data).toHaveLength(BRIEF_MAX_LINES + 1);
    expect(out.data.at(-1)).toBe(`-- ${BRIEF_MAX_LINES} of ${total} shown`);
  });

  it('leaves the full answer unchanged when no view is given', async () => {
    const client = makeClient({
      getParentPlans: async () => [{ PlanDate: '2026-11-02', Plans: [{ FirstName: 'Alex', TransportationName: 'Bus' }] }],
    });
    const h = await harness(client);
    const res = (await h.client.callTool({
      name: 'pup_list_plans',
      arguments: { start_date: '2026-11-02', end_date: '2026-11-02', view: 'full' },
    })) as { content: { text: string }[] };
    await h.close();
    const body = JSON.parse(res.content[0]!.text) as { days: Array<{ date: string }> };
    expect(body.days[0]!.date).toBe('2026-11-02');
  });
});
