/**
 * Build `dist/` — the thing that actually gets published as `@justcrawl/mcp-server`.
 *
 * Two outputs, and the reason for each:
 *
 *   dist/index.js      ESM bundle  — esbuild, `@justcrawl/sdk` inlined, shebang kept
 *   dist/package.json  manifest    — the PUBLIC name, a `bin`, exactly two deps
 *
 * **No CJS, no `.d.ts`.** This artifact is a binary a host spawns, not a library
 * anyone imports. Shipping a type surface would invite someone to depend on
 * internals that exist to be rearranged, and a CJS twin would double the bundle
 * for a consumer that does not exist.
 *
 * **Why the SDK is inlined and the other two are not.** `@scraperoute/sdk-js` is
 * `private: true` and will never exist on npm, so it has to be bundled — the
 * same reason sdk-js bundles `error-types`. Bundling it also keeps the two
 * packages version-locked: the server always ships the exact SDK code it was
 * tested against, so an SDK fix reaches customers through the server's next
 * release rather than through a semver range that could resolve to anything.
 * `@modelcontextprotocol/sdk` and `zod` stay external: both are large, both are
 * on their own release cadence, and a host that already has them installed
 * should not get a second copy.
 *
 * Run: pnpm --filter @scraperoute/mcp-server build
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PKG_ROOT, 'dist');

/** Where the mirror's build inputs are staged — under `dist/`, so gitignored. */
const MIRROR = join(DIST, 'mirror');

/** The npm name. Deliberately different from the workspace name. */
export const PUBLIC_NAME = '@justcrawl/mcp-server';

/** The command `npx -y @justcrawl/mcp-server` resolves to. */
export const BIN_NAME = 'justcrawl-mcp-server';

/**
 * The runtime dependencies that survive into the published artifact.
 *
 * Exactly two, and the manifest test asserts exactly two: every entry here is a
 * package a customer's `npm install` has to resolve, and the whole point of
 * bundling the SDK is that this list stays short enough to read.
 *
 * The versions are the ranges the source manifest declares, read at build time
 * rather than duplicated — a second copy would drift on the first dependency
 * bump with nothing to catch it.
 */
export const RUNTIME_DEPS = ['@modelcontextprotocol/sdk', 'zod'] as const;

/**
 * Exact build-tool versions the public mirror pins.
 *
 * Exact, not caret-ranged, for the reason spelled out in the sibling package:
 * provenance attests that npm built the tarball from a given commit, but says
 * nothing about what the build *resolved*, so a floating range means the same
 * source can publish different bytes. These pin the direct tools; their
 * transitive deps still float, which is what `mirror-package-lock.json` closes.
 */
export const MIRROR_BUILD_DEPS: Record<string, string> = {
  '@types/node': '26.4.0',
  esbuild: '0.25.12',
  tsx: '4.21.0',
  typescript: '5.9.3',
};

/** The committed mirror dependency tree, restamped by {@link buildMirrorLock}. */
export const MIRROR_LOCK_SOURCE = 'mirror-package-lock.json';

/**
 * The specifier the mirrored sources import instead of `@scraperoute/sdk-js`.
 *
 * `mirror-sdk.sh` vendors the SDK's built bundle to `src/vendor/sdk-js.js` (plus
 * its rolled-up types) and rewrites the one import in `src/sdk.ts` to this path.
 * Keeping the bare specifier and resolving it through a tsconfig `paths` entry
 * would leave `@scraperoute/…` strings in the public tree, and the mirror's leak
 * scan treats any such specifier as a hard failure. That control stays absolute.
 */
export const VENDORED_SDK = './vendor/sdk-js.js';

/**
 * The mirror repository, and the string npm provenance matches **character for
 * character**. A case difference fails the publish, not the build, so
 * `publish-manifest.pack.test.ts` asserts it rather than trusting it.
 *
 * Its own repo, not a directory inside the SDK's: npm provenance binds a package
 * to exactly one repository.
 */
export const REPOSITORY_URL = 'https://github.com/justcrawl-io/justcrawl-mcp-server';

/** Files copied verbatim into `dist/`. `CLAUDE.md` is deliberately absent. */
const COPIED_FILES = ['README.md', 'LICENSE'];

interface SourcePkg {
  version: string;
  dependencies?: Record<string, string>;
}

/**
 * Build the published manifest.
 *
 * Independent semver: the version comes from the source `package.json`'s
 * hand-maintained `version` field and is **not** the repo's `vX.Y.Z.W` — an MCP
 * user's semver expectations have nothing to do with the platform's release
 * cadence.
 */
export function buildManifest(sourcePkg: SourcePkg, options: { forMirror?: boolean } = {}): Record<string, unknown> {
  const dependencies: Record<string, string> = {};
  for (const name of RUNTIME_DEPS) {
    const range = sourcePkg.dependencies?.[name];
    if (range === undefined) {
      throw new Error(`${name} is missing from the source package.json dependencies — cannot build the manifest.`);
    }
    dependencies[name] = range;
  }

  const mirrorOnly =
    options.forMirror === true
      ? {
          // The mirror repo IS the build, so its manifest must be able to run
          // one. `--out .` puts index.js at the repo root, exactly where `bin`
          // and `files` below already point.
          scripts: { build: 'tsx scripts/build.ts --out .' },
          devDependencies: { ...MIRROR_BUILD_DEPS },
        }
      : {};

  return {
    name: PUBLIC_NAME,
    version: sourcePkg.version,
    description: 'The official MCP server for JustCrawl — scrape jobs, workflows, and BI from any LLM agent host',
    license: 'Apache-2.0',
    author: 'JustCrawl',
    homepage: 'https://docs.justcrawl.io/guides/agents/',
    repository: { type: 'git', url: `git+${REPOSITORY_URL}.git` },
    bugs: { url: `${REPOSITORY_URL}/issues` },
    keywords: ['justcrawl', 'mcp', 'model-context-protocol', 'scraping', 'crawler', 'agent', 'claude', 'cursor'],
    type: 'module',
    bin: { [BIN_NAME]: './index.js' },
    files: ['index.js', 'README.md', 'LICENSE'],
    dependencies,
    // AbortSignal.any, used by the bundled SDK's polling, shipped in 20.3.0. A
    // bare `>=20` installs cleanly on 20.0–20.2 and then throws an untyped
    // TypeError — the one failure mode this package cannot describe.
    engines: { node: '>=20.3.0' },
    publishConfig: { access: 'public', provenance: true },
    ...mirrorOnly,
  };
}

/**
 * The flattened tsconfig the mirror builds against.
 *
 * The in-repo `tsconfig.json` extends `../../../tsconfig.base.json`, which does
 * not exist outside the monorepo. Generated rather than hand-maintained in two
 * places so the settings that matter to the output cannot drift.
 */
export const MIRROR_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    rootDir: '.',
    types: ['node'],
  },
  include: ['src', 'scripts'],
  exclude: ['node_modules'],
};

/**
 * The committed dependency tree for the mirror, restamped for this release.
 *
 * The tree itself is committed rather than resolved at build time: it is the
 * thing under review, and generating it during the build would need the network
 * and re-float on every run. What is NOT committed is the identity block — a
 * lockfile's root entry repeats the package's own name and version, and `npm ci`
 * refuses to run when those disagree with package.json, so a fully committed one
 * would go stale at the first release bump with nothing to catch it.
 */
export function buildMirrorLock(sourcePkg: SourcePkg): Record<string, unknown> {
  const lock = JSON.parse(readFileSync(join(PKG_ROOT, MIRROR_LOCK_SOURCE), 'utf8')) as {
    name: string;
    version: string;
    packages: Record<string, { name?: string; version?: string; devDependencies?: Record<string, string> }>;
  };
  lock.name = PUBLIC_NAME;
  lock.version = sourcePkg.version;
  const root = lock.packages[''];
  root.name = PUBLIC_NAME;
  root.version = sourcePkg.version;
  // Single-sourced from MIRROR_BUILD_DEPS so a bump there cannot silently leave
  // the lockfile's declared range behind. (The RESOLVED tree still has to be
  // regenerated by hand — see the package CLAUDE.md.)
  root.devDependencies = { ...MIRROR_BUILD_DEPS };
  return lock;
}

function bundle(outfile: string): void {
  esbuild.buildSync({
    entryPoints: [join(PKG_ROOT, 'src/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    // Kept out of the bundle; declared as dependencies instead.
    external: [...RUNTIME_DEPS, `${RUNTIME_DEPS[0]}/*`],
    // No sourcemaps: they would ship internal repo paths to customers, and the
    // bundle is not minified, so they buy little.
    sourcemap: false,
    minify: false,
    legalComments: 'inline',
    // No `banner` re-attaching the shebang: esbuild hoists the entry file's own
    // `#!` line to the top of the bundle and sets the executable bit. Adding a
    // banner as well emits it twice, and the second one — no longer on line 1 —
    // is a hard syntax error rather than a shebang. `publish-manifest.pack.test.ts`
    // pins that there is exactly one.
  });
}

/** `--out <dir>`, resolved against the package root. Defaults to `dist`. */
function outDirFromArgv(argv: string[]): string {
  const i = argv.indexOf('--out');
  if (i === -1) return DIST;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error('--out needs a directory argument');
  }
  return join(PKG_ROOT, value);
}

function main(argv: string[]): void {
  const outDir = outDirFromArgv(argv);
  const intoDist = outDir === DIST;

  // Only safe to wipe when it is the build's own directory. With `--out .` — how
  // the mirror builds — this would delete the source tree it is building from.
  if (intoDist) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  bundle(join(outDir, 'index.js'));

  const sourcePkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as SourcePkg;

  if (intoDist) {
    // In the mirror the manifest is already the repo's own package.json — the
    // file the build was invoked through. Rewriting it mid-build would be both
    // pointless and destructive.
    writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(buildManifest(sourcePkg), null, 2)}\n`, 'utf8');
    for (const file of COPIED_FILES) cpSync(join(PKG_ROOT, file), join(outDir, file));

    mkdirSync(MIRROR, { recursive: true });
    writeFileSync(
      join(MIRROR, 'package.json'),
      `${JSON.stringify(buildManifest(sourcePkg, { forMirror: true }), null, 2)}\n`,
      'utf8',
    );
    writeFileSync(join(MIRROR, 'tsconfig.json'), `${JSON.stringify(MIRROR_TSCONFIG, null, 2)}\n`, 'utf8');
    writeFileSync(join(MIRROR, 'package-lock.json'), `${JSON.stringify(buildMirrorLock(sourcePkg), null, 2)}\n`, 'utf8');
  }

  console.log(`built ${PUBLIC_NAME}@${sourcePkg.version} → ${intoDist ? 'dist/' : outDir}`);
}

// Importable by the manifest test without running a build.
if (process.argv[1] !== undefined && process.argv[1].endsWith('build.ts')) {
  main(process.argv.slice(2));
}
