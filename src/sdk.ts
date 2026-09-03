/**
 * The one module that names the JustCrawl SDK.
 *
 * Everything else in `src/` imports from here rather than from the package
 * directly, and that indirection is load-bearing for the publish path: the SDK
 * is a private workspace package that would 404 on a customer's `npm install`,
 * so the mirror vendors its built bundle and rewrites the specifier. Funnelling
 * every import through one file makes that rewrite a single line in a single
 * file instead of a sweep across the tree — and keeps the relative depth of the
 * vendored path from depending on which directory a tool happens to live in.
 *
 * `tooling/scripts/mirror-sdk.sh` fails the mirror run if it rewrites nothing,
 * so this file going away without the script being updated is a loud error
 * rather than an unbuildable public repo.
 */

export { JustCrawl, JustCrawlError } from './vendor/sdk-js.js';
export type { JustCrawlErrorCode, JustCrawlOptions } from './vendor/sdk-js.js';
