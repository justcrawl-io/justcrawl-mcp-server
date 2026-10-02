#!/usr/bin/env node
/**
 * `@justcrawl/mcp-server` — the entry point an MCP host spawns.
 *
 * The host runs this process, writes JSON-RPC to its stdin, and reads JSON-RPC
 * from its stdout. Nothing else may be written to stdout; see `log.ts`.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ConfigError, loadConfig } from './config.js';
import * as log from './log.js';
import { createClient, createServer } from './server.js';
import { withSqlGuard } from './sql-guard.js';
import { SERVER_VERSION } from './version.js';

/**
 * Die quietly when the host closes the pipe.
 *
 * A host that exits mid-write leaves the transport writing into a closed stdout,
 * and Node delivers that as an asynchronous `error` event on the stream. Nothing
 * in the MCP SDK listens for it — its stdio transport attaches an error handler
 * to stdin only — so the default handling is an uncaught exception and a stack
 * trace on the way out. The host is already gone at that point, so the trace
 * lands nowhere useful and the exit code misreports a routine teardown as a
 * crash. Every other failure path in this file exits deliberately; this makes
 * the most common one match.
 */
function exitQuietlyOnBrokenPipe(): void {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    log.error(`stdout error: ${err.message}`);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  exitQuietlyOnBrokenPipe();
  const config = loadConfig(process.env);
  const server = createServer({ client: createClient(config) });

  // The guard wraps the transport, so a `sql` argument is refused before the
  // server sees it at all — see sql-guard.ts for why it cannot live in the tool
  // callbacks.
  await server.connect(withSqlGuard(new StdioServerTransport()));

  log.info(`justcrawl mcp server ${SERVER_VERSION} ready (api: ${config.baseUrl})`);
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    // A config problem is the operator's to fix, so print the sentence and
    // nothing else. A stack trace here reads as a crash and buries the fix.
    log.error(err.message);
    process.exit(1);
  }

  log.error(`failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
