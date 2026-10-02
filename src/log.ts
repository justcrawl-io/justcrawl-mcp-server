/**
 * Diagnostics, on stderr, always.
 *
 * stdout is the JSON-RPC channel. An MCP host reads it as a stream of framed
 * messages, so one stray `console.log` — a debug print, a dependency's warning,
 * an unhandled promise rejection's default handler — lands mid-frame and the
 * host reports an opaque parse failure with no hint about where it came from.
 * There is no "just this once": the channel is either clean or it is broken.
 *
 * Hence a module rather than a convention. Nothing in `src/` may call
 * `console.log`, and `stdout-purity.pack.test.ts` spawns the built binary to
 * prove it — a check no in-memory-transport test can make, because that
 * transport never touches a pipe.
 */

/** Written ahead of every line so a host's stderr pane says who is talking. */
const PREFIX = '[justcrawl-mcp]';

function write(level: string, message: string): void {
  // `process.stderr.write`, not `console.error`: console routes through a
  // formatter that can be monkey-patched by a host or a dependency, and at least
  // one MCP host redefines `console` wholesale. This writes to fd 2 directly.
  process.stderr.write(`${PREFIX} ${level} ${message}\n`);
}

export function info(message: string): void {
  write('info', message);
}

export function warn(message: string): void {
  write('warn', message);
}

export function error(message: string): void {
  write('error', message);
}
