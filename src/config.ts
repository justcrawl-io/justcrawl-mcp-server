/**
 * Environment → server configuration.
 *
 * Three variables, all read once at startup. The host process supplies them from
 * its own config file (`env` block in `claude_desktop_config.json`,
 * `~/.cursor/mcp.json`, `~/.codex/config.toml`), so a bad value is a config typo
 * a human can fix — which is why the failure below names the variable rather than
 * describing the symptom.
 */

/** The API base URL when `JUSTCRAWL_BASE_URL` is unset. */
export const DEFAULT_BASE_URL = 'https://api.justcrawl.io';

/** Per-request timeout when `JUSTCRAWL_TIMEOUT_MS` is unset. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

/**
 * A configuration problem the operator can fix, as opposed to a bug.
 *
 * Carried as its own class so `index.ts` can print it plainly and exit, instead
 * of dumping a stack trace into a host's stderr pane where it reads as a crash.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Read the configuration, or throw a {@link ConfigError} naming what to fix.
 *
 * Takes the environment as an argument rather than reaching for `process.env`
 * so the failure paths are testable without mutating global state — the kind of
 * test that passes alone and fails in a parallel run.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const apiKey = env.JUSTCRAWL_API_KEY?.trim();
  if (!apiKey) {
    // Blank is treated as missing on purpose: `"JUSTCRAWL_API_KEY": ""` in a
    // host config is a half-finished edit, and starting up to fail every tool
    // call with a 401 tells the user far less than refusing to start does.
    throw new ConfigError(
      'JUSTCRAWL_API_KEY is not set. Add your API key to the `env` block of this ' +
        'server in your MCP host config, then restart the host. Create a key at ' +
        'Settings → API Keys in the dashboard. Setup guide: https://docs.justcrawl.io/guides/agents/',
    );
  }

  const baseUrl = env.JUSTCRAWL_BASE_URL?.trim() || DEFAULT_BASE_URL;

  const rawTimeout = env.JUSTCRAWL_TIMEOUT_MS?.trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new ConfigError(`JUSTCRAWL_TIMEOUT_MS must be a positive number of milliseconds, got "${rawTimeout}".`);
    }
    timeoutMs = parsed;
  }

  return { apiKey, baseUrl, timeoutMs };
}
