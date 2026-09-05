/**
 * The version the server reports to its host during `initialize`.
 *
 * A literal rather than a `require('../package.json')`: the published artifact is
 * a single bundled file with no manifest beside it at the path the source
 * implies, so reading it at runtime works in the repo and throws for every
 * customer. `src/__tests__/version.test.ts` asserts this equals the manifest, so
 * the duplication is checked rather than trusted.
 */
export const SERVER_VERSION = '0.2.0';

/** The name the host displays for this server. */
export const SERVER_NAME = 'justcrawl';
