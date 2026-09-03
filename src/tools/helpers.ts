/**
 * Shared plumbing for every tool: one error path, one serialization, one size cap.
 */

import { toToolError, toolError, type ToolErrorResult } from '../errors.js';
import * as log from '../log.js';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

export type ToolResult = ToolTextResult | ToolErrorResult;

/**
 * How much text one tool result may carry.
 *
 * A scraped page body is routinely megabytes of HTML, and every character of a
 * tool result is spent from the model's context window. Truncating with a stated
 * count is strictly better than either of the alternatives: silently blowing the
 * window out, or refusing to return a result the caller paid to produce.
 */
export const MAX_RESULT_CHARS = 20_000;

/**
 * Truncate with an explicit, machine-readable marker rather than a silent cut.
 *
 * The returned string is never longer than `limit` — the marker is reserved for
 * INSIDE the budget, not appended past it. That matters because callers compose:
 * `jc_docs_get` caps a body to leave room for its provenance footer and then
 * hands the result to `textResult`, which caps again at the default. When `cap`
 * could overshoot, that second pass ate the end of the footer and returned a
 * half-written URL — the disclosure looked present and was unusable.
 */
export function cap(text: string, limit = MAX_RESULT_CHARS): string {
  if (text.length <= limit) return text;
  const marker = (omitted: number) =>
    `\n\n… [truncated: ${omitted} of ${text.length} characters omitted by the MCP server]`;
  // Size the reservation off the longest marker this text could produce, so the
  // slice never has to be recomputed against a marker that grew a digit.
  const keep = Math.max(0, limit - marker(text.length).length);
  return `${text.slice(0, keep)}${marker(text.length - keep)}`;
}

/** A JSON payload rendered for a model to read. */
export function jsonResult(value: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: cap(JSON.stringify(value, null, 2)) }] };
}

/** A plain-text payload. */
export function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text: cap(text) }] };
}

export { toolError };

/**
 * Run a tool body, turning any throw into a tool error result.
 *
 * Every tool goes through this so no callback can leak a stack trace or an
 * unmapped message into the model's context — and so the full detail still
 * reaches stderr, where a human debugging the host can see it.
 */
export async function run(name: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    log.error(`${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return toToolError(err);
  }
}

/**
 * Drop `undefined` entries from a query object.
 *
 * The SDK already omits `undefined` when serializing, but the generated query
 * types are exact, so passing a key the endpoint does not declare is a compile
 * error rather than a runtime one — this keeps the call sites building the
 * object in one readable literal instead of a chain of conditional spreads.
 */
export function compact<T extends Record<string, unknown>>(query: T): T {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as T;
}
