import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { schemaConfirm, textResult } from '@chrischall/mcp-utils';

export { schemaConfirm };

/**
 * Confirm-gate for a mutating tool (the fleet convention). Without
 * `confirm: true` the tool makes **no** network call and returns a dry-run
 * preview of exactly what would be sent.
 *
 * The gate matters more here than in most of the fleet: these writes change
 * how a child leaves school. A hallucinated call must not silently put a
 * student on a different bus.
 */
export function previewUnlessConfirmed(
  confirm: boolean | undefined,
  action: string,
  method: string,
  dto: string,
  body?: unknown,
): CallToolResult | null {
  if (confirm === true) return null;
  return textResult({
    dryRun: true,
    action,
    method,
    dto,
    ...(body !== undefined ? { willSend: body } : {}),
    note: 'Re-run with confirm: true to execute.',
  });
}
