import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import {
  confirmationFromEnv,
  confirmTokenParam,
  requireConfirmationWithFallback,
} from '@chrischall/mcp-utils';

export { confirmTokenParam };

/** What every gated tool's description says about the confirmation step. */
export const CONFIRM_FLOW =
  'Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE).';

export interface ConfirmWriteOptions {
  /** The tool name the token is bound to. */
  tool: string;
  /** `<service>.<verb>` identifier for the operation. */
  action: string;
  /** Human-readable sentence describing what will change. */
  summary: string;
  method: string;
  dto: string;
  /** The primary id acted on. */
  target: string;
  /** A version of the target that rotates on edit, when the API has one. */
  revision?: string | null | undefined;
  /** EXACTLY what the write will send — hashed into the token. */
  payload: unknown;
  /** What the preview shows as `willSend`; defaults to `payload`. */
  willSend?: unknown;
  /** The phase-2 token from the tool's input. */
  confirmToken: string | undefined;
}

/**
 * Confirm-gate for a mutating tool. A client that can show a prompt gets one;
 * one that cannot gets the two-step token flow (MCP_CONFIRM_MODE): phase 1
 * makes **no** write and returns the preview plus a token, phase 2 proceeds
 * only if the freshly rebuilt payload still matches what was previewed.
 * `undefined` means proceed; anything else is the result to return.
 *
 * The gate matters more here than in most of the fleet: these writes change
 * how a child leaves school. A hallucinated call must not silently put a
 * student on a different bus.
 */
export function confirmWrite(
  ctx: ServerContext,
  options: ConfirmWriteOptions,
): Promise<InputRequiredResult | CallToolResult | undefined> {
  const { tool, action, summary, method, dto, target, revision, payload, willSend, confirmToken } =
    options;
  const preview = { action: summary, method, dto, willSend: willSend ?? payload };
  return requireConfirmationWithFallback(
    ctx,
    confirmationFromEnv({
      action,
      message: `Review and confirm this change: ${summary}`,
      details: preview,
      tool,
      confirmToken,
      subject: () => ({
        target,
        ...(revision ? { revision } : {}),
        payload,
        preview,
      }),
    }),
  );
}
