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
