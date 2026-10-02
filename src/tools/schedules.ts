/** Schedule tools: create, inspect, enable or disable, and trigger recurring crawls. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { compact, jsonResult, run } from './helpers.js';

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
        'Run a schedule once, immediately, without changing its cadence or its next scheduled run. ' +
        'This queues real scrapes and spends credits — one per job, returned if no provider delivers a page.',
      inputSchema: {
        id: z.string().describe('Schedule id, from jc_schedules_list.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => run('jc_schedules_trigger', async () => jsonResult(await client.schedules.trigger(id))),
  );
}
