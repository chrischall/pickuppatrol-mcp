// Invariant: the environment variables a user is told about are the ones the
// server actually reads.
//
// - server.json is the MCP Registry listing; registry clients build their
//   config form from it, so a variable manifest.json passes but server.json
//   omits cannot be set by anyone installing from the registry — and without
//   isSecret the password is not masked.
// - .env.example must not advertise a variable nothing reads: it once offered
//   PICKUPPATROL_OTP to two-factor users, though no code consumes it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  server: { mcp_config: { env?: Record<string, string> } };
};
interface EnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}
const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8')) as {
  packages: { environmentVariables?: EnvVar[] }[];
};

const srcText = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(root, 'src', f), 'utf8'))
  .join('\n');

describe('env sync', () => {
  const manifestEnv = Object.keys(manifest.server.mcp_config.env ?? {}).sort();
  const declared = new Map(
    server.packages.flatMap((p) => p.environmentVariables ?? []).map((e) => [e.name, e]),
  );

  it('declares in server.json every env var manifest.json passes to the server', () => {
    expect(manifestEnv.length).toBeGreaterThan(0);
    expect(manifestEnv.filter((name) => !declared.has(name))).toEqual([]);
  });

  it('gives every declared env var a description', () => {
    const undocumented = [...declared.values()].filter((e) => !e.description?.trim()).map((e) => e.name);
    expect(undocumented).toEqual([]);
  });

  // The server boots without credentials (the config error is deferred to
  // request time so the host's install-time tools/list probe still answers),
  // so the listings must not force an install to invent a value — matching
  // manifest.json's user_config, which already marks both optional.
  it('marks the credentials optional and the password secret', () => {
    expect(declared.get('PICKUPPATROL_USERNAME')?.isRequired).toBe(false);
    expect(declared.get('PICKUPPATROL_PASSWORD')).toMatchObject({ isRequired: false, isSecret: true });
  });

  it('advertises in .env.example only variables the server reads', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    const named = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !srcText.includes(`'${name}'`))).toEqual([]);
  });
});
