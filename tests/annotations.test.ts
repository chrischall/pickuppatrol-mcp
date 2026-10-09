import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAccountTools } from '../src/tools/account.js';
import { registerSchoolTools } from '../src/tools/school.js';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { makeClient } from './helpers.js';

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

async function listAnnotated(): Promise<Map<string, Annotations | undefined>> {
  const client = makeClient();
  const h = await createTestHarness((s: McpServer) => {
    registerAccountTools(s, client);
    registerSchoolTools(s, client);
    registerPlanTools(s, client);
    registerDefaultPlanTools(s, client);
  });
  const { tools } = (await h.client.listTools()) as { tools: { name: string; annotations?: Annotations }[] };
  await h.close();
  return new Map(tools.map((t) => [t.name, t.annotations]));
}

describe('tool annotations', () => {
  // Hosts sort and auto-approve by these hints, so a tool with none gives them
  // nothing to go on — least of all for the writes that change how a child
  // leaves school.
  it('annotates every tool with an explicit readOnlyHint', async () => {
    const tools = await listAnnotated();
    expect(tools.size).toBeGreaterThan(0);
    const missing = [...tools].filter(([, a]) => typeof a?.readOnlyHint !== 'boolean').map(([n]) => n);
    expect(missing).toEqual([]);
  });

  it.each(['pup_set_plan', 'pup_set_default_plans'])(
    '%s says it is a destructive, idempotent write against an open world',
    async (name) => {
      expect((await listAnnotated()).get(name)).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    },
  );

  it('pup_mark_defaults_reviewed says it is a non-destructive, idempotent write', async () => {
    expect((await listAnnotated()).get('pup_mark_defaults_reviewed')).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
