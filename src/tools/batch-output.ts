/** Bounded, resumable public BatchJob payloads; no serialized JSON is sliced. */

import { z } from 'zod';

import { toToolError } from '../errors.js';
import * as log from '../log.js';
import { JustCrawlError } from '../sdk.js';
import type { ServerDeps } from '../server.js';
import { MAX_RESULT_CHARS, structuredJsonResult, UNTRUSTED, type StructuredToolResult } from './helpers.js';

const NEXT_TOOLS = ['jc_batch_jobs_list', 'jc_batch_jobs_save', 'jc_batch_jobs_count', 'jc_batch_input_upload',
  'jc_batch_jobs_start', 'jc_batch_runs_get', 'jc_batch_runs_entries', 'jc_jobs_get', 'jc_scrape_result',
  'jc_schedules_list', 'jc_schedules_trigger'] as const;

/** All continuations name registered tools and contain caller coordinates, never page content. */
export interface BatchNextStep {
  tool: typeof NEXT_TOOLS[number];
  arguments: Record<string, unknown>;
  reason: string;
}

/** Public SDK summary type; transport dates and nullable values come from OpenAPI. */
export type BatchRun = Awaited<ReturnType<ServerDeps['client']['batchJobRuns']['get']>>;

/** Shared output contract, including the mandatory metadata reserved before rows. */
export const batchOutputSchema = z.object({
  kind: z.string(),
  runId: z.string().nullable(),
  phase: z.string().nullable(),
  outcome: z.string().nullable(),
  entryMode: z.enum(['api', 'schedule_occurrence', 'schedule_run_now']).optional(),
  submissionKey: z.string().min(1).max(256).optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  scheduleName: z.string().max(256).nullable().optional(),
  skipReason: z.enum(['overlap', 'workflow_unresolved']).nullable().optional(),
  blockingRunId: z.string().uuid().nullable().optional(),
  blockingRunAgeSeconds: z.number().nonnegative().nullable().optional(),
  counts: z.record(z.string(), z.unknown()),
  contentWarning: z.literal(UNTRUSTED),
  items: z.array(z.record(z.string(), z.unknown())),
  returnedCount: z.number().int().nonnegative(),
  omittedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  continuation: z.record(z.string(), z.unknown()).nullable(),
  nextStep: z.object({ tool: z.enum(NEXT_TOOLS), arguments: z.record(z.string(), z.unknown()), reason: z.string() }),
}).passthrough();

/** Produce a tenant-safe validation error without echoing tool arguments. */
export function invalidBatchArguments(): never {
  throw new JustCrawlError({ message: 'Invalid BatchJob arguments', code: 'invalid_input', status: 0,
    inferredCode: true, shape: 'transport' });
}

/** Bound display prose while retaining lookup identities and structured row values intact. */
export function batchDisplayEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const result = { ...entry };
  const shortened: string[] = [];
  for (const name of ['url', 'parentUrl', 'childUrl', 'name', 'label', 'errorDetail']) {
    const value = result[name];
    if (typeof value === 'string' && value.length > 512) {
      result[name] = value.slice(0, 512);
      shortened.push(name);
    }
  }
  if (shortened.length) result.truncatedFields = shortened;
  return result;
}

/** Keep public counters, nullable preparation and exact run coordinates even for huge configurations. */
export function batchRunProjection(run: BatchRun): Record<string, unknown> {
  const snapshot = { ...run.definitionSnapshot, name: run.definitionSnapshot.name.slice(0, 256) };
  const complete = { ...run, scheduleName: run.scheduleName?.slice(0, 256) ?? null, definitionSnapshot: snapshot };
  if (JSON.stringify(complete).length <= 9_000) return complete;
  const { definitionSnapshot: _definition, routeMap: _routes, input: _input, discoveryPolicy: _policy, ...identityAndProgress } = complete;
  return { ...identityAndProgress, configurationOmitted: 'configuration_exceeds_response_budget',
    configurationReference: `/api/v1/batch-job-runs/${run.id}` };
}

/** Choose a finite follow-up for a run; a successful read of failed work remains a success. */
export function batchRunNextStep(run: BatchRun): BatchNextStep {
  if (run.outcome === 'skipped') {
    return run.skipReason === 'overlap' && run.blockingRunId
      ? { tool: 'jc_batch_runs_get', arguments: { id: run.blockingRunId },
        reason: 'This skip consumed its invocation key. Hand the result back or check the blocking run after at least 30 seconds; after it settles, a deliberate new trigger needs a new key.' }
      : { tool: 'jc_schedules_list', arguments: {},
        reason: 'Workflow resolution prevented this occurrence. Fix its published workflow or Automatic routing; this skip consumed its key, so a deliberate new trigger needs a new key.' };
  }
  return run.phase === 'terminal'
    ? { tool: 'jc_batch_runs_entries', arguments: { id: run.id, view: 'jobs' }, reason: 'Inspect the retained jobs and their content references.' }
    : { tool: 'jc_batch_runs_get', arguments: { id: run.id }, reason: 'Hand the durable handle back to the user, or re-check after at least 30 seconds; do not poll in a loop.' };
}

/** Build the fixed metadata before considering any variable entries. */
export function batchEnvelope(kind: string, nextStep: BatchNextStep, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, runId: null, phase: null, outcome: null, counts: {}, contentWarning: UNTRUSTED,
    items: [], returnedCount: 0, omittedCount: 0, hasMore: false, continuation: null, nextStep, ...extra };
}

/** Reserve the authoritative run identity, phase, outcome and both progress counter sets. */
export function batchRunEnvelope(kind: string, run: BatchRun, nextStep = batchRunNextStep(run)): Record<string, unknown> {
  return batchEnvelope(kind, nextStep, { runId: run.id, phase: run.phase, outcome: run.outcome,
    entryMode: run.entryMode, submissionKey: run.submissionKey,
    scheduleId: run.scheduleId, scheduleName: run.scheduleName?.slice(0, 256) ?? null,
    skipReason: run.skipReason, blockingRunId: run.blockingRunId, blockingRunAgeSeconds: run.blockingRunAgeSeconds,
    counts: { initialCount: run.initialCount, seed: run.seed, descendant: run.descendant },
    summary: batchRunProjection(run) });
}

/** Fit whole rows; a reference-only omission also consumes its per-entry cursor. */
export function batchPageResult(options: {
  base: Record<string, unknown>;
  items: readonly Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
  tool: BatchNextStep['tool'];
  arguments: Record<string, unknown>;
  project?: (entry: Record<string, unknown>) => Record<string, unknown>;
  reference: (entry: Record<string, unknown>) => Record<string, unknown>;
}): StructuredToolResult {
  const rows: Record<string, unknown>[] = [];
  let omittedCount = 0;
  const finish = (seen: number): Record<string, unknown> => {
    const shortened = seen < options.items.length;
    const hasMore = shortened || options.hasMore;
    const cursor = shortened ? options.items[seen - 1]?.cursorAfter : options.nextCursor;
    if (hasMore && typeof cursor !== 'string') throw new Error('Batch page has no usable per-entry cursor');
    const continuation = hasMore ? { ...options.arguments, cursor } : null;
    const nextStep: BatchNextStep = continuation
      ? { tool: options.tool, arguments: continuation, reason: 'Continue after the last returned entry using these exact filters and cursor.' }
      : options.base.nextStep as BatchNextStep;
    return { ...options.base, items: rows, returnedCount: rows.length, omittedCount, hasMore, continuation, nextStep };
  };
  for (const entry of options.items) {
    const row = options.project?.(entry) ?? batchDisplayEntry(entry);
    rows.push(row);
    if (JSON.stringify(finish(rows.length)).length <= MAX_RESULT_CHARS) continue;
    rows.pop();
    if (rows.length > 0) break;
    rows.push({ ...options.reference(entry), dataOmitted: 'row_exceeds_response_budget' });
    omittedCount += 1;
    if (JSON.stringify(finish(rows.length)).length > MAX_RESULT_CHARS) throw new Error('Batch reference exceeds response budget');
  }
  return structuredJsonResult(finish(rows.length));
}

/** Convert failures into bounded structured errors that retain a safe registered next step. */
export async function runBatchTool(name: string, nextStep: () => BatchNextStep,
  body: () => Promise<StructuredToolResult>, context: () => Record<string, unknown> = () => ({})): Promise<StructuredToolResult> {
  try { return await body(); }
  catch (error) {
    log.error(`${name} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    const safe = toToolError(error);
    return { ...structuredJsonResult(batchEnvelope('error', nextStep(), {
      ...context(), error: { code: error instanceof JustCrawlError ? error.code : 'internal_error',
        detail: safe.content[0].text.slice(0, 1_000) },
    })), isError: true };
  }
}
