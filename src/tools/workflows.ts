/**
 * Workflow tools — read-only. Creating and editing workflows is a visual,
 * multi-step activity that belongs in the dashboard builder, not in a chat turn.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { compact, jsonResult, run } from './helpers.js';

/** Register `jc_workflows_list` and `jc_workflows_get` on the server. */
export function registerWorkflowTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_workflows_list',
    {
      title: 'List workflows',
      description:
        'The workflows in this organization. Each row carries two uuids: pass the `workflowId` to other ' +
        'tools — `id` is the version row and no endpoint accepts it.',
      inputSchema: {
        status: z.enum(['draft', 'published']).optional().describe('Only workflows in this state.'),
        domain: z.string().optional().describe('Only workflows routed to this domain.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ status, domain }) =>
      run('jc_workflows_list', async () => jsonResult(await client.workflows.list(compact({ status, domain })))),
  );

  server.registerTool(
    'jc_workflows_get',
    {
      title: 'Get a workflow',
      description: 'One workflow with its full node graph.',
      inputSchema: {
        // Named `workflowId`, not `id`, because the object returned by
        // jc_workflows_list has both and the obvious one is the wrong one: `id`
        // is the primary key of a version row, changes on every edit, and is
        // accepted by no endpoint. Naming the argument after the field that
        // works is the cheapest available guard.
        workflowId: z
          .string()
          .describe('The workflow\'s stable logical id — the `workflowId` field from jc_workflows_list, not `id`.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ workflowId }) => run('jc_workflows_get', async () => jsonResult(await client.workflows.get(workflowId))),
  );
}
