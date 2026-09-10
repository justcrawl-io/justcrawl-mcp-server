/**
 * Search over the bundled documentation snapshot.
 *
 * Hand-rolled, and that is the point: a search dependency would be a third
 * runtime dependency on a published package, shipped to serve 52 pages. Term
 * scoring across title / description / heading / body is enough to answer "which
 * page explains X", which is the only question these tools are asked.
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
  generatedAt: string;
  site: string;
  pages: DocPage[];
}

export const DOCS: DocsCorpus = corpus as DocsCorpus;

/** Weights, in the order a reader would rank them. */
const WEIGHT = { title: 12, description: 5, heading: 4, body: 1 } as const;

export interface DocHit {
  slug: string;
  title: string;
  description: string;
  url: string;
  score: number;
  /** The first line of body text mentioning a query term, for the model to judge relevance from. */
  snippet: string;
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
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

/** The absolute URL of a page on the live site. */
export function urlFor(slug: string): string {
  // The home page carries the empty slug, and `${site}//` is not its URL.
  return slug === '' ? `${DOCS.site}/` : `${DOCS.site}/${slug}/`;
}

export function findPage(slug: string): DocPage | undefined {
  const normalized = slug
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.(md|mdx)$/, '')
    // A model asking for the home page will spell it `index`, `/`, or ``. The
    // corpus stores it as the empty slug; accept all three rather than making
    // the site's front page the one page a caller cannot name.
    .replace(/(^|\/)index$/, '');
  return DOCS.pages.find((page) => page.slug === normalized);
}

/**
 * Slugs closest to one that did not match.
 *
 * A wrong slug is the common failure — a model guesses `guides/agent` for
 * `guides/agents` — so a bare "not found" wastes a turn. Ranked by shared path
 * segments and then by substring overlap.
 */
export function nearestSlugs(slug: string, limit = 5): string[] {
  const wanted = slug.toLowerCase().replace(/^\/+|\/+$/g, '');
  const parts = wanted.split('/');
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
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit)
    .map((c) => c.slug);
}

export function search(query: string, limit = 8): DocHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

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
      // Body hits are capped: a term repeated forty times in one reference page
      // should not outrank the page whose title is that term.
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
    // Reward pages that matched more of the query, so a two-word search prefers
    // the page covering both words over one that repeats the commoner word.
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

  return hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug)).slice(0, limit);
}

function snippetFor(page: DocPage, wanted: string[]): string {
  const lines = page.body.split('\n');
  const hit = lines.find((line) => {
    const lower = line.toLowerCase();
    return line.trim().length > 20 && wanted.some((term) => lower.includes(term));
  });
  const chosen = (hit ?? page.description ?? lines.find((l) => l.trim().length > 20) ?? '').trim();
  return chosen.length > 240 ? `${chosen.slice(0, 240)}…` : chosen;
}
