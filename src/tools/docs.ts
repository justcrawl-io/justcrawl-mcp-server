/**
 * Documentation tools.
 *
 * The only two tools that make no network call — they serve from the snapshot
 * bundled into the package (see `scripts/build-docs-index.ts`). Both disclose
 * the snapshot date and link the live page, every time, because a stale answer
 * that admits it is stale is useful and one that does not is worse than no
 * answer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DOCS, findPage, nearestSlugs, search, urlFor } from '../docs-index.js';
import { cap, jsonResult, MAX_RESULT_CHARS, run, textResult } from './helpers.js';

/** Appended to every response from both tools. */
function provenance(url: string): string {
  return `Documentation snapshot taken ${DOCS.generatedAt} and bundled into this package. The live, current page is ${url} — check it if the answer might have changed since then.`;
}

/** Register `jc_docs_search` and `jc_docs_get` on the server. */
export function registerDocsTools(server: McpServer): void {
  server.registerTool(
    'jc_docs_search',
    {
      title: 'Search the JustCrawl docs',
      description:
        'Full-text search over the JustCrawl documentation. Returns ranked pages with a snippet and the ' +
        'live URL for each; read one in full with jc_docs_get.',
      inputSchema: {
        query: z.string().min(2).describe('Words to search for, e.g. "retry policy" or "presigned result url".'),
        limit: z.number().int().positive().max(25).optional().describe('How many pages to return. Defaults to 8.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) =>
      run('jc_docs_search', async () => {
        const hits = search(query, limit ?? 8);
        if (hits.length === 0) {
          return jsonResult({
            query,
            hits: [],
            note: `Nothing in the documentation matched. ${provenance(DOCS.site)}`,
          });
        }
        return jsonResult({
          query,
          hits,
          snapshotDate: DOCS.generatedAt,
          note: provenance(DOCS.site),
        });
      }),
  );

  server.registerTool(
    'jc_docs_get',
    {
      title: 'Read a JustCrawl docs page',
      description: 'The full text of one documentation page, by the slug jc_docs_search returned.',
      inputSchema: {
        slug: z
          .string()
          .describe('Page slug without leading slash or extension, e.g. "guides/agents" or "guides/errors/not_found".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ slug }) =>
      run('jc_docs_get', async () => {
        const page = findPage(slug);
        if (!page) {
          const near = nearestSlugs(slug);
          return jsonResult({
            slug,
            found: false,
            // Not a tool error: "no such page" is an answer, and handing back
            // the near misses lets the model correct itself in the same turn
            // instead of guessing again.
            nearest: near,
            note:
              near.length > 0
                ? 'No page with that slug. Try one of `nearest`, or search with jc_docs_search.'
                : 'No page with that slug. Use jc_docs_search to find one.',
          });
        }

        // Cap the BODY, not the composed string. The provenance line is last,
        // so capping the whole thing truncates the snapshot disclosure off
        // exactly the pages long enough to need it — and a stale snapshot the
        // model cannot see is stale is the one failure this package promises
        // not to have. `guides/providers` is over 32k today and would lose it.
        const footer = ['', '---', provenance(urlFor(page.slug))].join('\n');
        const head = [`# ${page.title}`, page.description, '', page.body]
          .filter((part) => part !== undefined)
          .join('\n');

        return textResult(cap(head, MAX_RESULT_CHARS - footer.length) + footer);
      }),
  );
}
