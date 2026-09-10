/**
 * URL library tools — listing only.
 *
 * URLs *are* created here, but only as a side effect of `jc_jobs_submit`, where
 * adding the row is a precondition of the scrape the caller asked for. A
 * standalone create/delete pair would be library management, which is dashboard
 * work.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { compact, jsonResult, run } from './helpers.js';

/** Register `jc_urls_list` on the server. */
export function registerUrlTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_urls_list',
    {
      title: 'List URLs',
      description: "The URLs tracked in this organization's library, with their tags and schedule state.",
      inputSchema: {
        search: z.string().optional().describe('Substring match against the URL.'),
        tag: z.string().optional().describe('Only URLs carrying this tag slug.'),
        domain: z.string().optional().describe('Only URLs on this domain.'),
        page: z.number().int().positive().optional().describe('1-based page number.'),
        pageSize: z.number().int().positive().max(100).optional().describe('Rows per page (max 100).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ search, tag, domain, page, pageSize }) =>
      run('jc_urls_list', async () =>
        jsonResult(await client.urls.list(compact({ search, tag, domain, page, pageSize }))),
      ),
  );
}
