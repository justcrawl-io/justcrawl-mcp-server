/** Schedule tools: create, inspect, enable or disable, and trigger recurring crawls. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { BatchJobSubmissionIndeterminateError } from '../sdk.js';
import { compact, jsonResult, run, structuredJsonResult } from './helpers.js';
import { batchEnvelope, batchOutputSchema, batchRunEnvelope, runBatchTool } from './batch-output.js';

const FREQUENCIES = [
  'every_5_minutes',
  'every_10_minutes',
  'every_15_minutes',
  'every_30_minutes',
  'hourly',
  'every_2_hours',
  'every_3_hours',
  'every_4_hours',
  'every_6_hours',
  'every_8_hours',
  'every_12_hours',
  'daily',
  'weekly',
  'monthly',
  'custom',
] as const;

/** Register the selected schedule-management tools on the server. */
export function registerScheduleTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_schedules_create',
    {
      title: 'Create schedule',
      description:
        'Create a recurring scrape schedule. Enabled schedules repeatedly queue real jobs and spend credits. ' +
        'Pass an empty tagFilters array (or omit it) to select every enabled URL in the organization; listed ' +
        'filters match URLs carrying at least one listed tag. Omit workflowId or pass null for Automatic routing. ' +
        'Count first with jc_batch_jobs_count using the matching tags, then show the URL count and large-run warning before enabling. ' +
        'Recurring runs spend credits, may take hours and have no customer cancellation. ' +
        'Requires schedules:write and a verified account email.',
      inputSchema: {
        name: z.string().min(1).describe('Display name shown on schedule runs.'),
        workflowId: z
          .string()
          .nullable()
          .optional()
          .describe('Published workflow id, or null/omitted for Automatic routing per URL.'),
        frequency: z.enum(FREQUENCIES).describe('Recurring cadence. Use custom only with cronExpr.'),
        cronExpr: z.string().optional().describe('Standard five-field cron expression; required for custom cadence.'),
        timezone: z.string().optional().describe('IANA timezone. Defaults to UTC.'),
        tagFilters: z
          .array(z.string())
          .max(50)
          .optional()
          .describe(
            'URLs must carry at least one listed tag. Empty or omitted selects every enabled URL in the organization.',
          ),
        isEnabled: z
          .boolean()
          .optional()
          .describe('Whether recurring runs begin immediately. Defaults to true.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, workflowId, frequency, cronExpr, timezone, tagFilters, isEnabled }) =>
      run('jc_schedules_create', async () =>
        jsonResult(
          await client.schedules.create(
            compact({ name, workflowId, frequency, cronExpr, timezone, tagFilters, isEnabled }),
          ),
        ),
      ),
  );

  server.registerTool(
    'jc_schedules_list',
    {
      title: 'List schedules',
      description: 'The recurring crawls configured in this organization, with their cadence and enabled state.',
      inputSchema: {
        isEnabled: z.boolean().optional().describe('Only enabled (true) or only disabled (false) schedules.'),
        domain: z.string().optional().describe('Only schedules for URLs on this domain.'),
        tag: z.string().optional().describe('Only schedules for URLs carrying this tag slug.'),
        page: z.number().int().positive().optional().describe('1-based page number.'),
        pageSize: z.number().int().positive().max(100).optional().describe('Rows per page (max 100).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ isEnabled, domain, tag, page, pageSize }) =>
      run('jc_schedules_list', async () =>
        jsonResult(await client.schedules.list(compact({ isEnabled, domain, tag, page, pageSize }))),
      ),
  );

  server.registerTool(
    'jc_schedules_set_enabled',
    {
      title: 'Enable or disable a schedule',
      description:
        'Set a schedule to the requested enabled state without changing its definition. This is desired-state, ' +
        'not a blind flip. Enabling resumes recurring jobs and their credit spend; disabling stops future runs. ' +
        'Requires schedules:write and a verified account email.',
      inputSchema: {
        id: z.string().describe('Schedule id, from jc_schedules_list.'),
        isEnabled: z.boolean().describe('The desired state: true to enable, false to disable.'),
      },
      // Repeating the same state still changes server timestamps, so this must
      // not claim idempotency even though the requested state is explicit.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, isEnabled }) =>
      run('jc_schedules_set_enabled', async () => jsonResult(await client.schedules.toggle(id, { isEnabled }))),
  );

  server.registerTool(
    'jc_schedules_trigger',
    {
      title: 'Trigger a schedule now',
      description:
        'Accept a schedule run immediately, even when disabled, without changing its cadence or next occurrence. ' +
        'Count first with jc_batch_jobs_count for the matching selector and show the URL count and large-run warning before confirmation. ' +
        'This spends credits — one per job, returned if no provider delivers a page — may take hours and has no customer cancellation. ' +
        'Choose optional maxJobs to cap admission. Keep submissionKey and normalized intent through uncertainty; recover with entryMode schedule_run_now. ' +
        'Returns an accepted, replayed or skipped handle. A skip consumes its key: after the blocker settles, a deliberate new trigger needs a new key.',
      inputSchema: {
        id: z.string().uuid().describe('Schedule id, from jc_schedules_list.'),
        maxJobs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().describe('Optional cap on admitted jobs, not a count estimate.'),
        submissionKey: z.string().min(1).max(256).optional().describe('Reuse only for the same intent or recovery. Omit for a new deliberate invocation.'),
      },
      outputSchema: batchOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, maxJobs, submissionKey }) => {
      const key = submissionKey ?? globalThis.crypto.randomUUID();
      return runBatchTool('jc_schedules_trigger', () => ({ tool: 'jc_schedules_list', arguments: {},
        reason: 'Inspect the schedule and resolve the stated refusal before another invocation.' }), async () => {
        try {
          const accepted = await client.schedules.trigger(id, compact({ maxJobs }), { idempotencyKey: key });
          return structuredJsonResult({ ...batchRunEnvelope(accepted.outcome === 'skipped' ? 'run_skipped' : 'run_accepted', accepted),
            replayed: accepted.replayed });
        } catch (error) {
          if (!(error instanceof BatchJobSubmissionIndeterminateError)) throw error;
          return structuredJsonResult(batchEnvelope('run_submission', { tool: 'jc_batch_runs_get',
            arguments: { submissionKey: error.submissionKey, entryMode: error.entryMode },
            reason: (error.status === 401 || error.status === 403 ? 'Restore authentication or permissions, then recover. ' : '') +
              'Recover by exact key before starting new work. Zero matches means acceptance never committed; repeat the same intent with the same key. A recovered skip consumes its key; a later deliberate trigger needs a new key.' },
          { submissionStatus: 'indeterminate', entryMode: error.entryMode, submissionKey: error.submissionKey,
            operation: error.operation, source: { scheduleId: id } }));
        }
      });
    },
  );
}
