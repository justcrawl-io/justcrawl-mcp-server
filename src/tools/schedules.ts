/**
 * Schedule tools: look at the recurring crawls, and kick one off now.
 *
 * `jc_schedules_trigger` is one of the two non-read tools. It is included
 * because it changes no configuration — it runs the crawl the schedule already
 * describes, one turn earlier than it would have run anyway. Creating, editing,
 * enabling, and deleting schedules stay out.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { compact, jsonResult, run } from './helpers.js';

/** Register `jc_schedules_list` and `jc_schedules_trigger` on the server. */
export function registerScheduleTools(server: McpServer, { client }: ServerDeps): void {
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
    'jc_schedules_trigger',
    {
      title: 'Trigger a schedule now',
      description:
        'Run a schedule once, immediately, without changing its cadence or its next scheduled run. ' +
        'This queues real scrapes and spends credits.',
      inputSchema: {
        id: z.string().describe('Schedule id, from jc_schedules_list.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => run('jc_schedules_trigger', async () => jsonResult(await client.schedules.trigger(id))),
  );
}
