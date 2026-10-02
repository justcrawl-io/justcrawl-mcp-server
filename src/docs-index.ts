/**
 * Pure search and lookup helpers for the generated public-documentation corpus.
 *
 * This source is copied byte-for-byte into each consumer. Keep it dependency
 * free: MCP deliberately retains its two-runtime-dependency package boundary,
 * while agent-tools compiles the JSON import into its own `dist/` tree.
 */

import corpus from './docs/corpus.json' with { type: 'json' };

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  headings: string[];
  body: string;
}

export interface DocsCorpus {
  schemaVersion: number;
  contentHash: string;
  sourceHash: string;
  generatedAt: string;
  site: string;
  pages: DocPage[];
}

export interface DocHit {
  slug: string;
  title: string;
  description: string;
  url: string;
  score: number;
  /** The first useful body line mentioning a query term. */
  snippet: string;
}

/** The one process-wide parsed copy of the generated corpus. */
export const DOCS: DocsCorpus = corpus as DocsCorpus;

const WEIGHT = { title: 12, description: 5, heading: 4, body: 1 } as const;

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 1);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function normalizeLookupSlug(slug: string): string | undefined {
  const trimmed = slug.trim();
  const withoutSite = trimmed.toLowerCase().startsWith(DOCS.site.toLowerCase())
    ? trimmed.slice(DOCS.site.length)
    : trimmed;
  const normalized = withoutSite
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.(md|mdx)$/i, '')
    .replace(/(^|\/)index$/i, '')
    .toLowerCase();
  if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
  return normalized;
}

/** Return the absolute live-site URL for a normalized public page slug. */
export function urlFor(slug: string): string {
  return slug === '' ? `${DOCS.site}/` : `${DOCS.site}/${slug}/`;
}

/** Find a page by a safe home/index/path spelling, or `undefined` when absent. */
export function findPage(slug: string): DocPage | undefined {
  const normalized = normalizeLookupSlug(slug);
  if (normalized === undefined) return undefined;
  return DOCS.pages.find((page) => page.slug === normalized);
}

/** Return nearby public slugs for a safe miss without exposing filesystem paths. */
export function nearestSlugs(slug: string, limit = 5): string[] {
  const wanted = normalizeLookupSlug(slug);
  if (wanted === undefined) return [];
  const parts = wanted.split('/');
  const boundedLimit = Math.max(0, Math.min(Math.trunc(limit), 25));

  return DOCS.pages
    .map((page) => {
      const candidate = page.slug.toLowerCase();
      let score = 0;
      for (const part of parts) {
        if (part.length > 1 && candidate.includes(part)) score += part.length;
      }
      if (candidate.startsWith(parts[0] ?? '')) score += 2;
      return { slug: page.slug, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, boundedLimit)
    .map((candidate) => candidate.slug);
}

/** Search the process-wide public corpus with deterministic, bounded ranking. */
export function search(query: string, limit = 8): DocHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 25));

  const hits: DocHit[] = [];
  for (const page of DOCS.pages) {
    const title = page.title.toLowerCase();
    const description = page.description.toLowerCase();
    const headings = page.headings.join(' \n ').toLowerCase();
    const body = page.body.toLowerCase();

    let score = 0;
    let matchedTerms = 0;
    for (const term of wanted) {
      const inTitle = countOccurrences(title, term);
      const inDescription = countOccurrences(description, term);
      const inHeadings = countOccurrences(headings, term);
      const inBody = Math.min(countOccurrences(body, term), 8);
      const termScore =
        inTitle * WEIGHT.title +
        inDescription * WEIGHT.description +
        inHeadings * WEIGHT.heading +
        inBody * WEIGHT.body;
      if (termScore > 0) matchedTerms += 1;
      score += termScore;
    }

    if (score === 0) continue;
    score *= matchedTerms / wanted.length;
    hits.push({
      slug: page.slug,
      title: page.title,
      description: page.description,
      url: urlFor(page.slug),
      score: Math.round(score * 100) / 100,
      snippet: snippetFor(page, wanted),
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, boundedLimit);
}

function snippetFor(page: DocPage, wanted: string[]): string {
  const lines = page.body.split('\n');
  const hit = lines.find((line) => {
    const lower = line.toLowerCase();
    return line.trim().length > 20 && wanted.some((term) => lower.includes(term));
  });
  const chosen = (hit ?? page.description ?? lines.find((line) => line.trim().length > 20) ?? '').trim();
  return chosen.length > 240 ? `${chosen.slice(0, 240)}…` : chosen;
}
