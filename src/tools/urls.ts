/** URL library tools: add one supported URL and inspect the organization library. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ServerDeps } from '../server.js';
import { compact, jsonResult, run } from './helpers.js';

/** Register the selected URL-library tools on the server. */
export function registerUrlTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_urls_create',
    {
      title: 'Create URL',
      description:
        "Add one URL to this organization's library. This is additive and a duplicate returns a conflict. " +
        'The platform rejects private or loopback targets. Requires urls:write.',
      inputSchema: {
        url: z.httpUrl().describe('Absolute public http or https URL.'),
        priority: z
          .number()
          .int()
          .optional()
          .describe('Optional integer dispatch priority; higher values run first under contention.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    // The route advertises `tags`, but does not consume them. Deliberately send
    // only the two fields the real handler supports until that API is repaired.
    async ({ url, priority }) =>
      run('jc_urls_create', async () => jsonResult(await client.urls.create(compact({ url, priority })))),
  );

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
