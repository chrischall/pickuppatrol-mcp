import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult, type TestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerPlanTools } from '../src/tools/plans.js';
import { registerDefaultPlanTools } from '../src/tools/defaults.js';
import { BUS, makeClient, makeStudent, SCHOOL_ID, STUDENT_ID } from './helpers.js';

const MONDAY = '2026-08-17';

type Body = Record<string, unknown>;
type Client = ReturnType<typeof makeClient>;

const register = (client: Client) => (s: McpServer) => {
  registerPlanTools(s, client);
  registerDefaultPlanTools(s, client);
};

// A harness created WITHOUT an elicitation handler is a client that cannot be
// prompted, so the default MCP_CONFIRM_MODE (ask-user) runs the token flow.
const noPrompt = (client: Client) => createTestHarness(register(client));

const CONFIRM_ENV = ['MCP_CONFIRM_MODE', 'MCP_CONFIRM_TTL_SECONDS', 'MCP_CONFIRM_SECRET'] as const;
let savedEnv: Partial<Record<(typeof CONFIRM_ENV)[number], string | undefined>>;
beforeEach(() => {
  savedEnv = Object.fromEntries(CONFIRM_ENV.map((k) => [k, process.env[k]]));
  for (const k of CONFIRM_ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of CONFIRM_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

interface GatedCase {
  tool: string;
  args: Body;
  write: (c: Client) => ReturnType<typeof vi.fn>;
  dto: string;
}

const CASES: GatedCase[] = [
  {
    tool: 'pup_set_plan',
    args: { student_id: STUDENT_ID, dates: [MONDAY], transportation_id: BUS.TransportationId },
    write: (c) => c.updatePlans as unknown as ReturnType<typeof vi.fn>,
    dto: 'UpdatePlans',
  },
  {
    tool: 'pup_set_default_plans',
    args: { student_id: STUDENT_ID, days: ['Tuesday'], transportation_id: BUS.TransportationId },
    write: (c) => c.updateStudent as unknown as ReturnType<typeof vi.fn>,
    dto: 'Student',
  },
  {
    tool: 'pup_set_default_plans',
    args: { student_id: STUDENT_ID, clear_all: true },
    write: (c) => c.updateStudent as unknown as ReturnType<typeof vi.fn>,
    dto: 'Student',
  },
  {
    tool: 'pup_mark_defaults_reviewed',
    args: { student_id: STUDENT_ID },
    write: (c) => c.setDefaultsReviewed as unknown as ReturnType<typeof vi.fn>,
    dto: 'SetDefaultsReviewed',
  },
];

async function phaseOne(h: TestHarness, tool: string, args: Body): Promise<Body> {
  const result = await h.callTool(tool, args);
  expect(result.isError).toBeFalsy();
  return parseToolResult<Body>(result);
}

describe.each(CASES)('$tool $args two-step confirmation', ({ tool, args, write, dto }) => {
  it('phase 1 previews and writes nothing; phase 2 with the token writes exactly once', async () => {
    const client = makeClient();
    const h = await noPrompt(client);

    const first = await phaseOne(h, tool, args);
    expect(first['status']).toBe('confirmation-required');
    expect(first['dispatched']).toBe(false);
    expect(typeof first['confirmToken']).toBe('string');
    const preview = first['preview'] as Body;
    expect(preview['method']).toBe('PUT');
    expect(preview['dto']).toBe(dto);
    expect(preview).toHaveProperty('willSend');
    expect(typeof preview['action']).toBe('string');
    expect(write(client)).not.toHaveBeenCalled();

    const second = await h.callTool(tool, { ...args, confirmToken: first['confirmToken'] });
    expect(second.isError).toBeFalsy();
    expect(parseToolResult<Body>(second)['status']).toBeUndefined();
    expect(write(client)).toHaveBeenCalledTimes(1);
    await h.close();
  });
});

describe('confirm token guarantees', () => {
  it('previews the exact UpdatePlans payload in phase 1', async () => {
    const client = makeClient();
    const h = await noPrompt(client);
    const first = await phaseOne(h, 'pup_set_plan', CASES[0]!.args);
    expect((first['preview'] as Body)['willSend']).toEqual({
      Plans: [
        {
          StudentId: STUDENT_ID,
          SchoolId: SCHOOL_ID,
          PlanDate: MONDAY,
          TransportationId: BUS.TransportationId,
          TransportationName: 'Bus',
          Note: null,
        },
      ],
    });
    await h.close();
  });

  it('refuses a replayed token with TOKEN_REUSED and does not write again', async () => {
    const client = makeClient();
    const h = await noPrompt(client);
    const args = { student_id: STUDENT_ID };
    const first = await phaseOne(h, 'pup_mark_defaults_reviewed', args);
    const withToken = { ...args, confirmToken: first['confirmToken'] };
    await h.callTool('pup_mark_defaults_reviewed', withToken);
    expect(client.setDefaultsReviewed).toHaveBeenCalledTimes(1);

    const replay = await h.callTool('pup_mark_defaults_reviewed', withToken);
    expect(replay.isError).toBe(true);
    expect(parseToolResult<Body>(replay)['error']).toBe('TOKEN_REUSED');
    expect(client.setDefaultsReviewed).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it('refuses a token when an argument changed between the phases (DRAFT_CHANGED)', async () => {
    const client = makeClient();
    const h = await noPrompt(client);
    const first = await phaseOne(h, 'pup_set_plan', {
      student_id: STUDENT_ID,
      dates: [MONDAY],
      transportation_id: BUS.TransportationId,
    });
    const changed = await h.callTool('pup_set_plan', {
      student_id: STUDENT_ID,
      dates: ['2026-08-18'],
      transportation_id: BUS.TransportationId,
      confirmToken: first['confirmToken'],
    });
    expect(changed.isError).toBe(true);
    const body = parseToolResult<Body>(changed);
    expect(body['error']).toBe('DRAFT_CHANGED');
    expect(body['reason']).toBe('payload-changed');
    expect(client.updatePlans).not.toHaveBeenCalled();
    await h.close();
  });

  // Read-modify-write: the whole student record round-trips, so a change to it
  // between preview and approval would be silently overwritten. The fresh read
  // on phase 2 catches it.
  it('refuses a default-plans write when the student record changed after the preview', async () => {
    const client = makeClient({
      getStudent: vi
        .fn()
        .mockResolvedValueOnce(makeStudent({ ModifiedDate: '2026-08-01T10:00:00' }))
        .mockResolvedValueOnce(
          makeStudent({ ModifiedDate: '2026-08-01T11:00:00', DefaultCarNumber: '99' }),
        ),
    });
    const h = await noPrompt(client);
    const args = { student_id: STUDENT_ID, days: ['Tuesday'], transportation_id: BUS.TransportationId };
    const first = await phaseOne(h, 'pup_set_default_plans', args);
    const second = await h.callTool('pup_set_default_plans', { ...args, confirmToken: first['confirmToken'] });
    expect(second.isError).toBe(true);
    expect(parseToolResult<Body>(second)['error']).toBe('DRAFT_CHANGED');
    expect(client.updateStudent).not.toHaveBeenCalled();
    await h.close();
  });

  it('writes on a client that accepts the elicitation prompt', async () => {
    const client = makeClient();
    const h = await createTestHarness(register(client), {
      elicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
    });
    const result = await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID });
    expect(result.isError).toBeFalsy();
    expect(client.setDefaultsReviewed).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it('does not write on a client that declines the elicitation prompt', async () => {
    const client = makeClient();
    const h = await createTestHarness(register(client), {
      elicitation: async () => ({ action: 'decline' }),
    });
    await h.callTool('pup_mark_defaults_reviewed', { student_id: STUDENT_ID });
    expect(client.setDefaultsReviewed).not.toHaveBeenCalled();
    await h.close();
  });

  it('refuses the write under MCP_CONFIRM_MODE=refuse on a client that cannot be prompted', async () => {
    process.env['MCP_CONFIRM_MODE'] = 'refuse';
    const client = makeClient();
    const h = await noPrompt(client);
    const result = await h.callTool('pup_set_plan', CASES[0]!.args);
    expect(parseToolResult<Body>(result)['reason']).toBe('confirmation-unsupported');
    expect(client.updatePlans).not.toHaveBeenCalled();
    await h.close();
  });
});
