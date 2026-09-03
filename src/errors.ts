/**
 * SDK failures → MCP tool error results.
 *
 * A failed tool call is not a protocol error. MCP distinguishes the two, and the
 * distinction matters here: a protocol error is a bug in the client/server
 * conversation, while "that job id does not exist" is an *answer* the model
 * should read and act on. So everything below returns `{ isError: true }`
 * content rather than throwing — the agent gets to see what went wrong and try
 * something else.
 *
 * **What is deliberately NOT forwarded: the error's message text.** The SDK
 * carries a typed `code`, an HTTP `status`, and a `requestId`, and those three
 * are enough for both the model and a support conversation. The message is the
 * one field whose content this package does not control — it can carry API
 * response text, and this process is holding a customer's API key. Emitting a
 * fixed sentence per code keeps the blast radius of a future server-side change
 * at zero.
 *
 * That includes the BI SQL-syntax text the platform passes through verbatim
 * elsewhere. The carve-out that permits it requires that the text describe SQL
 * *the caller typed themselves*; here the caller is an agent running a query a
 * human saved in the dashboard, so the condition does not hold and the text
 * stays out.
 */

import { JustCrawlError, type JustCrawlErrorCode } from './sdk.js';

/** The MCP result shape a tool returns. Structural, so no SDK type import is needed. */
export interface ToolErrorResult {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

/**
 * BI codes the server sends that are NOT in the platform's closed error enum.
 *
 * `@scraperoute/error-types` owns the closed union, and the BI console predates
 * it: the SDK forwards a server-sent code it does not recognise rather than
 * flattening it (see its `looksLikeCode` branch), so these three arrive intact
 * and are worth a sentence. Spelled out here because they cannot be checked
 * against the union the way every other key below is.
 */
type BiQueryCode = 'invalid_sql' | 'feature_disabled' | 'too_many_queries';

/**
 * One fixed sentence per error code.
 *
 * Written for the model, not for a log: each says what happened and what a
 * sensible next step is, because the reader is deciding whether to retry, ask
 * the user something, or give up.
 *
 * **Typed against `JustCrawlErrorCode`, not `string`**, because a key that
 * matches no real code is invisible: the lookup simply misses and the caller
 * gets `fallbackMessage(status)` — a correct sentence, so nothing fails, and the
 * tailored one silently never appears. Four keys here were exactly that until
 * 2026-09-03 (`unauthorized`, `forbidden`, `validation_error`,
 * `insufficient_credits`), which covered 401/403/400/402 — the four statuses a
 * first-run misconfiguration actually produces.
 */
const CODE_MESSAGES: Partial<Record<JustCrawlErrorCode | BiQueryCode, string>> = {
  auth_missing: 'No API key reached the server. Set JUSTCRAWL_API_KEY in the MCP host config and restart the host.',
  auth_invalid: 'The API key was rejected. Check JUSTCRAWL_API_KEY in the MCP host config and restart the host.',
  auth_forbidden: 'This API key does not have permission for that operation.',
  not_found: 'No such record. Check the id — listing tools are the reliable way to get a valid one.',
  invalid_input: 'The request arguments were rejected as invalid.',
  rate_limited: 'Rate limited. Wait before retrying.',
  payment_required: 'The organization is out of credits. Top up in the dashboard before submitting more work.',
  quota_exceeded: 'A plan quota is exhausted. Check the plan in the dashboard.',
  timeout: 'The request timed out before the API answered. Retrying is reasonable.',
  network_error: 'Could not reach the JustCrawl API. Check network connectivity.',
  internal_error: 'The JustCrawl API failed to handle the request.',
  service_unavailable: 'The JustCrawl API is temporarily unavailable. Retrying after a pause is reasonable.',
  feature_disabled: 'That feature is not enabled for this organization.',
  too_many_queries: 'This organization already has too many BI queries in flight. Wait for one to finish.',
  invalid_sql: 'The saved query failed to parse as valid SQL. Fix it in the dashboard BI console.',
};

/** Used when the code is one this build has no sentence for. */
function fallbackMessage(status: number): string {
  if (status >= 500) return 'The JustCrawl API failed to handle the request.';
  if (status >= 400) return 'The JustCrawl API rejected the request.';
  return 'The request to the JustCrawl API did not succeed.';
}

/** Build the `isError` text result. Exported for the tools to reuse on refusals. */
export function toolError(text: string): ToolErrorResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * Map any thrown value to a tool error result.
 *
 * Non-SDK throws (a bug in this package, an OOM, a bad argument that slipped
 * past zod) collapse to one generic sentence: there is no safe way to render an
 * arbitrary `Error` from an unknown origin into a customer-visible channel, and
 * the stack is on stderr for whoever is debugging.
 */
export function toToolError(err: unknown): ToolErrorResult {
  if (err instanceof JustCrawlError) {
    const message = CODE_MESSAGES[err.code] ?? fallbackMessage(err.status);
    const parts = [message, `code: ${err.code}`];
    // status 0 is the SDK's marker for "never reached the server" (transport,
    // timeout, abort). Printing `status: 0` would read as a real HTTP status.
    if (err.status > 0) parts.push(`status: ${err.status}`);
    if (err.requestId) parts.push(`request id: ${err.requestId}`);
    return toolError(parts.join(' | '));
  }

  return toolError('The tool failed unexpectedly. See the server log on stderr for detail.');
}
