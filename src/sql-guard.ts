/**
 * The "no raw SQL" boundary.
 *
 * The published documentation says the server *rejects* any `sql` field in tool
 * arguments. Two things follow from that sentence, and both are load-bearing:
 *
 *  1. **It is a property of the server, not of the BI tools.** Guarding
 *     `jc_bi_run_saved` alone would be enough today and would silently stop
 *     being enough the first time someone adds a tool that takes a free-form
 *     object. The check is global so that a new tool inherits it.
 *
 *  2. **Rejecting is not the same as ignoring.** Zod strips unknown keys, so
 *     without this guard a `sql` argument would be quietly dropped — safe, but
 *     invisible. An agent that has been talked into exfiltrating data (by
 *     instructions hidden in a scraped page, which is the realistic threat here)
 *     would see a normal-looking success and no signal that anything was
 *     refused. A visible refusal is what makes the boundary legible to the model
 *     and to whoever reads the transcript afterwards.
 *
 * The check therefore runs on the RAW request arguments, before schema
 * validation and before dispatch — see {@link withSqlGuard}.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { isJSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * The refusal, worded identically every time.
 *
 * Static by design: an error that quoted the offending value back would put
 * attacker-authored text into the model's context, which is the input this
 * guard exists to distrust.
 */
export const SQL_REFUSAL_MESSAGE =
  'Refused: this server does not accept raw SQL. Tool arguments may not contain a "sql" field. ' +
  'To run a query, save it in the JustCrawl dashboard BI console and call jc_bi_run_saved with its id.';

/** How deep to walk before refusing. Bounds a self-referential or hostile payload. */
const MAX_DEPTH = 12;

/**
 * True when `value` contains a `sql` key anywhere inside it.
 *
 * Case-insensitive because JSON keys are attacker-chosen and `SQL`, `Sql`, and
 * `sql` are the same field to any reader. Recursive because nesting one level
 * down (`{ options: { sql: … } }`) is the obvious way around a shallow check.
 * Matches the key exactly rather than as a substring: `sqlDialect` is a
 * plausible future argument name and is not the thing being guarded, while a
 * substring rule would reject it and teach the next author to work around the
 * guard.
 */
export function containsSqlKey(value: unknown, depth = 0): boolean {
  // Fail CLOSED at the ceiling. A payload too deep to inspect is refused rather
  // than waved through — the same discipline `mirror-sdk.sh`'s leak scan applies
  // to a grep it cannot run. Returning `false` here would make the one bound in
  // this function the one way past it, which is the opposite of what a guard is
  // for. Nothing legitimate is lost: every registered `inputSchema` is a flat
  // object of scalars, nowhere near twelve levels.
  if (depth > MAX_DEPTH) return true;
  if (value === null || typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    return value.some((item) => containsSqlKey(item, depth + 1));
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase() === 'sql') return true;
    if (containsSqlKey(nested, depth + 1)) return true;
  }
  return false;
}

/**
 * Wrap a transport so an offending `tools/call` is answered with a refusal and
 * never reaches the server.
 *
 * Implemented at the transport rather than inside each tool callback because by
 * the time a callback runs the arguments have already been through zod, which
 * strips what it does not recognise — the guard would be inspecting a sanitized
 * object and could never see the field it is supposed to reject. This layer sees
 * the bytes as sent.
 *
 * The wrapper is transport-agnostic on purpose: the same code path runs over
 * stdio in production and over the in-memory pair in tests, so the tests
 * exercise the real guard rather than a stand-in.
 */
export function withSqlGuard(inner: Transport): Transport {
  // `Protocol.connect()` assigns `onmessage` on the transport it is handed. We
  // hand it this wrapper, keep whatever it assigns, and install our own listener
  // on the real transport underneath.
  let downstream: Transport['onmessage'];

  const wrapper: Transport = {
    async start() {
      inner.onmessage = (message, extra) => {
        if (isGuardedCall(message)) {
          void inner.send(refusalFor(message.id));
          return;
        }
        downstream?.(message, extra);
      };
      inner.onclose = () => wrapper.onclose?.();
      inner.onerror = (err) => wrapper.onerror?.(err);
      await inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    get sessionId() {
      return inner.sessionId;
    },
    setProtocolVersion: inner.setProtocolVersion?.bind(inner),
  };

  // `onmessage` is a plain property on the Transport interface, so the assignment
  // Protocol makes has to be intercepted rather than merely read.
  Object.defineProperty(wrapper, 'onmessage', {
    get: () => downstream,
    set: (handler: Transport['onmessage']) => {
      downstream = handler;
    },
    enumerable: true,
    configurable: true,
  });

  return wrapper;
}

function isGuardedCall(message: JSONRPCMessage): message is JSONRPCMessage & { id: string | number } {
  if (!isJSONRPCRequest(message) || message.method !== 'tools/call') return false;
  const params = message.params as { arguments?: unknown } | undefined;
  return containsSqlKey(params?.arguments);
}

/**
 * A tool-level refusal, not a JSON-RPC error.
 *
 * `isError: true` inside a normal result is what puts the sentence in front of
 * the model. A JSON-RPC error would be handled by the host's plumbing and, in
 * several hosts, never surfaced to the model at all — so the agent would retry
 * blind instead of learning that this door is closed.
 */
function refusalFor(id: string | number): JSONRPCMessage {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      content: [{ type: 'text', text: SQL_REFUSAL_MESSAGE }],
    },
  } as JSONRPCMessage;
}
