/**
 * The provider catalogue.
 *
 * Reached through the typed `client.request()` against the spec's own path
 * template rather than a resource wrapper, because `@justcrawl/sdk` deliberately
 * has no `ProvidersResource` — this is capability data for whoever is *choosing*
 * a provider, and an SDK caller already knows which one they want. An agent
 * being asked "can JustCrawl render JavaScript on this site?" is the case that
 * wants it.
 *
 * `requestUnchecked()` would have worked before `GET /api/v1/providers` was
 * published, and that is exactly why the route was documented first: an
 * unchecked path is a string checked against nothing, so a rename upstream
 * would surface here as a 404 at a customer's desk rather than as a compile
 * error in CI.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ServerDeps } from '../server.js';
import { jsonResult, run } from './helpers.js';

/** Register `jc_providers_list` on the server. */
export function registerProviderTools(server: McpServer, { client }: ServerDeps): void {
  server.registerTool(
    'jc_providers_list',
    {
      title: 'List scraping providers',
      description:
        'The scraping providers this platform can route to, and what each supports — JS rendering, ' +
        'geo-targeting, screenshots, session stickiness, timeout ceilings. This is platform-wide capability ' +
        'data, not this organization\'s connection state: it does not say which providers have credentials ' +
        'configured. Manage provider accounts in the dashboard.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run('jc_providers_list', async () => jsonResult(await client.request('get', '/api/v1/providers'))),
  );
}
