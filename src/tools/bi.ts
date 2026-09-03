/**
 * BI tools: list the queries a human saved, and run one.
 *
 * **Neither tool accepts SQL.** The platform has no run-a-saved-query endpoint,
 * so `jc_bi_run_saved` reads the saved row's own `sql` and submits it — the SQL
 * crosses the wire, but it never crosses the *tool* boundary, which is where the
 * guarantee lives (see `sql-guard.ts`). A caller can only ever run something a
 * human already wrote and saved in the dashboard.
 *
 * Saved queries have no parameter model — the row is `{name, sql, description,
 * chartConfig}` and there is nothing to bind — so this tool takes an id and
 * nothing else. Do not add a `params` argument without adding the server-side
 * binding first.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as log from '../log.js';
import type { ServerDeps } from '../server.js';
import { jsonResult, run, toolError } from './helpers.js';

/**
 * How long to wait for a query before handing back a still-running handle.
 *
 * Bounded, and short, for two reasons. An MCP host times its own tool calls out,
 * and a server that blocks past that deadline turns a slow query into an opaque
 * failure. And a stalled turn is worse for the caller than an explicit "still
 * running, ask again with this id" — which the model can act on.
 */
const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 750;

/** Rows returned in one go. The API caps `pageSize` at 100. */
const PAGE_SIZE = 100;

interface QueryStatus {
  jobId?: string;
  status?: string;
  results?: unknown;
  error?: { code?: string; message?: string; retriable?: boolean };
}

/** Register `jc_bi_list_saved_queries` and `jc_bi_run_saved` on the server. */
export function registerBiTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_bi_list_saved_queries',
    {
      title: 'List saved BI queries',
      description:
        'The BI queries saved in this organization, with their names and descriptions. Run one with ' +
        'jc_bi_run_saved. New queries are written in the dashboard BI console — this server cannot create them.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run('jc_bi_list_saved_queries', async () => jsonResult(await client.bi.listSavedQueries())),
  );

  server.registerTool(
    'jc_bi_run_saved',
    {
      title: 'Run a saved BI query',
      description:
        'Run one of the saved queries by id and return the first page of rows. Takes an id only — this ' +
        'server does not accept SQL, and saved queries take no parameters. Long-running queries return a ' +
        'handle instead of rows; call again with the same id to check.',
      inputSchema: {
        id: z.string().describe('Saved-query id, from jc_bi_list_saved_queries.'),
        queryId: z
          .string()
          .optional()
          .describe('A run id from a previous still-running response. Resumes waiting instead of running it again.'),
      },
      // No `idempotentHint`. It would be true of the `queryId` resume path and
      // false of the ordinary `{ id }` call, which submits a fresh run every
      // time and spends the org's query capacity — and a host that trusts the
      // hint to make a timed-out call safe to retry would spend it twice.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, queryId }) =>
      run('jc_bi_run_saved', async () => {
        let runId = queryId;
        let name: string | undefined;

        if (!runId) {
          const saved = (await client.bi.getSavedQuery(id)) as { sql?: string; name?: string };
          name = saved.name;
          if (typeof saved.sql !== 'string' || saved.sql.trim() === '') {
            return toolError('That saved query has no SQL stored against it.');
          }

          const submitted = (await client.bi.runQuery({ sql: saved.sql, label: nameLabel(saved.name) })) as QueryStatus;
          const settled = describeIfSettled(submitted, saved.name);
          // The submit call waits a short while server-side, so a fast query is
          // already finished here and needs no poll at all — but only when it
          // actually came back with rows. The route has a third outcome,
          // "success but hydration failed", which reports success and carries no
          // `results`; short-circuiting on that returned a success with neither
          // rows nor a handle, leaving the caller nothing to do next. Fall
          // through to the poll, which re-fetches results on its own.
          if (settled && (settled.status !== 'success' || settled.results !== undefined)) {
            return jsonResult(settled);
          }
          if (typeof submitted.jobId !== 'string') {
            return toolError('The query was submitted but the API returned no run id.');
          }
          runId = submitted.jobId;
        }

        // One budget across the whole wait, threaded into every request.
        // `deadline` alone gates only the ITERATIONS: a poll GET carries the
        // SDK's retry ladder, which honours `Retry-After` and can sit far past
        // MAX_WAIT_MS inside a single iteration — turning the bounded wait this
        // tool advertises into an opaque host-side timeout.
        const budget = AbortSignal.timeout(MAX_WAIT_MS);
        const stillRunning = (note: string) =>
          jsonResult({ status: 'still_running', queryId: runId, savedQueryId: id, note });

        try {
          while (!budget.aborted) {
            await sleep(POLL_INTERVAL_MS);
            const current = (await client.bi.getQuery(runId, { signal: budget })) as QueryStatus;
            const settled = describeIfSettled(current, name);
            if (settled) {
              if (settled.status !== 'success') return jsonResult(settled);
              const page = await client.bi.getResults(runId, { page: 1, pageSize: PAGE_SIZE }, { signal: budget });
              return jsonResult({ ...settled, results: page });
            }
          }
        } catch (err) {
          // The run outlives this tool call, so the handle is the valuable
          // thing — losing it to a transport blip would leave the model with
          // only one move, re-running the query, which spends the org's BI
          // capacity a second time for an answer already being computed.
          if (budget.aborted) {
            return stillRunning(
              `Still running after ${MAX_WAIT_MS / 1000}s. Call jc_bi_run_saved again with queryId="${runId}" to keep waiting — it will not re-run the query.`,
            );
          }
          log.error(`jc_bi_run_saved: polling ${runId} failed: ${err instanceof Error ? err.message : String(err)}`);
          return stillRunning(
            `The query is running but checking on it failed. Call jc_bi_run_saved again with queryId="${runId}" to resume waiting — do not re-run it, that would start a second run.`,
          );
        }

        return stillRunning(
          `Still running after ${MAX_WAIT_MS / 1000}s. Call jc_bi_run_saved again with queryId="${runId}" to keep waiting — it will not re-run the query.`,
        );
      }),
  );
}

/**
 * Render a terminal query state, or `undefined` while it is still going.
 *
 * The failure is **projected, not forwarded**. The `code` is what tells the
 * caller whether to retry or go fix the query, and it is a closed vocabulary we
 * control; `message` is not. The platform passes raw Postgres text through for
 * SQLSTATE 42601 (`classifyPgError` in `bi-postgres`), and that carve-out is
 * written for a human typing SQL into the console and reading the error about
 * their own keystrokes. Here the caller is an agent running a query somebody
 * else saved, so the condition the carve-out rests on does not hold — the same
 * reasoning `errors.ts` applies to every other API error, applied consistently.
 */
function describeIfSettled(
  state: QueryStatus,
  name: string | undefined,
): { status: string; savedQueryName?: string; results?: unknown; error?: QueryFailure } | undefined {
  if (state.status === 'success') {
    // `POST /api/v1/bi/queries` nests a completed page under `results`; the
    // status route does not. Passing it through when present saves a round trip.
    return { status: 'success', savedQueryName: name, results: state.results };
  }
  if (state.status === 'failed' || state.status === 'canceled') {
    return { status: state.status, savedQueryName: name, error: projectFailure(state.error) };
  }
  return undefined;
}

/** What a caller learns about a failed run: never the raw engine text. */
interface QueryFailure {
  code?: string;
  retriable?: boolean;
  detail: string;
}

/**
 * One fixed sentence per query-failure code.
 *
 * Separate from `errors.ts`'s `CODE_MESSAGES`, which maps *transport* failures
 * (the request did not succeed). These describe a request that succeeded and
 * returned a query that did not.
 */
const FAILURE_DETAIL: Record<string, string> = {
  syntax_error: 'The saved query is not valid SQL. Fix it in the dashboard BI console.',
  statement_timeout: 'The query ran too long and was stopped. It may need narrowing before it can complete.',
  rls_denied: 'The query touched data this organization is not permitted to read.',
  canceled: 'The run was canceled.',
};

function projectFailure(error: QueryStatus['error']): QueryFailure {
  const code = error?.code;
  return {
    code,
    retriable: error?.retriable,
    detail:
      (code ? FAILURE_DETAIL[code] : undefined) ??
      'The query failed. Open it in the dashboard BI console to see the engine error.',
  };
}

/** Query history is a human-facing list, so the run says where it came from. */
function nameLabel(name: string | undefined): string {
  return name ? `MCP: ${name}`.slice(0, 200) : 'MCP saved query run';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
