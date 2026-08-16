import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

describe('version sync', () => {
  it('keeps every release-please-marked literal in sync with package.json', () => {
    expect(
      versionSyncTest({ srcDir: join(root, 'src'), pkgPath: join(root, 'package.json') }),
    ).toEqual([]);
  });

  // release-please rewrites these through `extra-files`; a manifest missing
  // from that list drifts silently until a release PR fails CI.
  it.each([
    ['manifest.json', (j: Record<string, any>) => j['version']],
    ['server.json', (j: Record<string, any>) => j['version']],
    ['server.json', (j: Record<string, any>) => j['packages'][0]['version']],
    ['.claude-plugin/plugin.json', (j: Record<string, any>) => j['version']],
    ['.claude-plugin/marketplace.json', (j: Record<string, any>) => j['metadata']['version']],
    ['.claude-plugin/marketplace.json', (j: Record<string, any>) => j['plugins'][0]['version']],
  ])('%s carries the package version', (file, pick) => {
    const json = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
    expect(pick(json)).toBe(pkg.version);
  });
});

describe('packaging', () => {
  const full = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  // npm rejects a --provenance publish whose package.json repository.url does
  // not match the sigstore bundle — and it fails AFTER release-please has
  // already tagged, so the release looks green while npm never moves.
  it('declares the repository provenance requires', () => {
    expect(full['repository']).toEqual({
      type: 'git',
      url: 'git+https://github.com/chrischall/pickuppatrol-mcp.git',
    });
  });

  it('publishes under the @chrischall scope with public access', () => {
    expect(full['name']).toBe('@chrischall/pickuppatrol-mcp');
    expect((full['publishConfig'] as Record<string, unknown>)['access']).toBe('public');
  });

  // Without "skills" in files, the shell-out skill silently does not ship.
  it('ships the skills directory on npm', () => {
    expect(full['files']).toContain('skills');
  });

  it('keeps the server.json description within the registry limit', () => {
    const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
      description: string;
    };
    // mcp-publisher 422s above 100 characters.
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('points the plugin at the skills directory so skills are auto-discovered', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')) as {
      skills: string;
    };
    expect(plugin.skills).toBe('./skills/');
  });
});

describe('manifest tool roster', () => {
  // manifest.json's `tools` array is what an mcpb host shows at install time,
  // so a tool missing from it is invisible to the user even though the server
  // registers it. Nothing else catches the drift: the server starts fine, the
  // tool works when called by name, and no other test reads this file.
  // pup_list_car_numbers was absent for exactly that reason.
  it('lists every tool the server actually registers, and no others', async () => {
    const { createTestHarness } = await import('@chrischall/mcp-utils/test');
    const { makeClient } = await import('./helpers.js');
    const { registerAccountTools } = await import('../src/tools/account.js');
    const { registerSchoolTools } = await import('../src/tools/school.js');
    const { registerPlanTools } = await import('../src/tools/plans.js');
    const { registerDefaultPlanTools } = await import('../src/tools/defaults.js');

    const client = makeClient();
    const h = await createTestHarness((s) => {
      registerAccountTools(s, client);
      registerSchoolTools(s, client);
      registerPlanTools(s, client);
      registerDefaultPlanTools(s, client);
    });
    const registered = (await h.listTools()).map((t) => t.name).sort();
    await h.close();

    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      tools: { name: string; description: string }[];
    };
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(registered);
    // A blank description is as useless to the install UI as a missing entry.
    for (const tool of manifest.tools) expect(tool.description.trim()).not.toBe('');
  });
});
