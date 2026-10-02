# @justcrawl/mcp-server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for
[JustCrawl](https://justcrawl.io) — submit scrape jobs, browse workflows, run
safe structured or saved BI queries, and search the docs from inside Claude Desktop, Cursor, or
Codex CLI.

It speaks MCP over **stdio**: your agent host spawns it as a local process, and
it talks to the JustCrawl REST API over HTTPS using your API key. Nothing runs on
JustCrawl's side that a `curl` with the same key could not do.

Version 0.3.0 includes 29 tools, with authorized BI discovery, structured queries,
saved-query replay, result continuation, CSV/Parquet exports, URL and schedule
creation, and a bundled documentation snapshot.

## Install

Nothing to install — your MCP host runs it with `npx`. You need **Node.js 20.3
or newer** and a JustCrawl API key (Settings → API Keys in the dashboard; it
starts with `sr_live_` and is shown once).

Listing, creating and revoking that key requires `org:manage` (Owner and Admin
by default). The MCP tools use the key creator's current role permissions;
existing keys with permitted job or BI access continue to work after this
administration gate is applied.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "justcrawl": {
      "command": "npx",
      "args": ["-y", "@justcrawl/mcp-server"],
      "env": { "JUSTCRAWL_API_KEY": "sr_live_your_key_here" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project) — same shape as
above.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.justcrawl]
command = "npx"
args = ["-y", "@justcrawl/mcp-server"]
env = { JUSTCRAWL_API_KEY = "sr_live_your_key_here" }
```

Restart the host after editing its config — all three read it only at startup.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `JUSTCRAWL_API_KEY` | yes | Your `sr_live_…` API key. The server exits immediately with a message on stderr if it is missing or blank. |
| `JUSTCRAWL_BASE_URL` | no | Override the API base URL. Defaults to `https://api.justcrawl.io`. |
| `JUSTCRAWL_TIMEOUT_MS` | no | Per-request timeout in milliseconds. Defaults to `30000`. |

## Tools

| Tool | What it does |
|------|-------------|
| `jc_scrape` | Scrape a URL: builds or reuses a multi-vendor workflow for its domain, starts the job, and returns the workflow diagram |
| `jc_scrape_result` | Wait for a `jc_scrape` job and return the page content, plus extracted fields once the workflow has them |
| `jc_scrape_extract` | Name fields to pull from this domain's pages from now on, and get them for the page just scraped |
| `jc_jobs_submit` | Submit a single scrape job for a URL |
| `jc_jobs_submit_and_wait` | Submit a job and wait for its result in one call |
| `jc_jobs_list` | Paginated job list, filter by status or workflow |
| `jc_jobs_get` | Fetch a job, and its result once the job has finished |
| `jc_workflows_list` | Browse the workflows in your org |
| `jc_workflows_get` | One workflow, by its `workflowId` |
| `jc_providers_list` | List the scraping providers the platform supports and what each can do |
| `jc_urls_create` | Add one URL to your library with an optional dispatch priority |
| `jc_urls_list` | List URLs in your library, filter by tag or search |
| `jc_bi_get_schema` | Discover only the BI tables authorized for your organization, with a versioned continuation |
| `jc_bi_get_table` | Describe one discovered table's columns, types, and available org-scoped samples |
| `jc_bi_query` | Run a safe structured aggregate over discovered tables and return display-only SQL plus resumable results |
| `jc_bi_list_saved_queries` | List one bounded page of BI saved queries, with an opaque continuation when more remain |
| `jc_bi_save_query` | Save one completed `jc_bi_query` execution by query id, preserving its server-owned scope |
| `jc_bi_run_saved` | Run one of those saved queries and return a resumable result handle |
| `jc_bi_get_results` | Read or continue one materialized query without running it again |
| `jc_bi_create_export` | Create or reuse a CSV or Parquet export for one completed query |
| `jc_bi_get_export` | Poll an export handle and return a fresh presigned download URL when ready |
| `jc_bi_cancel_query` | Request cancellation and wait briefly for the terminal state |
| `jc_bi_list_queries` | List recent handles or recover one by exact `submissionKey` |
| `jc_schedules_create` | Create a recurring schedule, optionally disabled or using Automatic routing |
| `jc_schedules_list` | List your schedules |
| `jc_schedules_set_enabled` | Set one schedule explicitly enabled or disabled |
| `jc_schedules_trigger` | Trigger a one-off run of a schedule |
| `jc_docs_search` | Search the JustCrawl documentation |
| `jc_docs_get` | Read one documentation page |

Twelve tools do something other than read: `jc_scrape`, `jc_scrape_extract`, `jc_jobs_submit`, `jc_jobs_submit_and_wait`, `jc_urls_create`, `jc_schedules_create`, `jc_schedules_set_enabled`, `jc_schedules_trigger`, `jc_bi_save_query` (it creates a reusable saved object from a completed query), `jc_bi_run_saved` (it starts a run of a query you already saved, spending a BI concurrency slot), `jc_bi_create_export` (it starts or reuses bounded export work), and `jc_bi_cancel_query`. Everything else is read-only.
Nothing here can delete a workflow, a URL, or a schedule.

`jc_urls_create` accepts only `url` and optional `priority`; URL tags are not
supported by the single-create API handler and are deliberately absent from the
tool. `jc_schedules_create` creates recurring work: enabled schedules repeatedly
queue real jobs and spend credits. Omit `tagFilters` or pass an empty list to
select every enabled URL in the organization, and omit `workflowId` or pass
`null` for Automatic routing. `jc_schedules_set_enabled` always sends the
desired boolean state, never a blind flip. These writes retain the REST API's
`urls:write` or `schedules:write` checks, organization scope, and verified-email
gate for schedules.

The complete SDK-to-MCP disposition, including deliberate omissions, lives in
[CAPABILITIES.md](./CAPABILITIES.md). It is checked in both directions against
the public SDK resource methods and the registered tool inventory.

Catalog discovery is bounded. Follow the returned table-name or column-name
continuation exactly; if `restartRequired` is true, restart from
`jc_bi_get_schema` with the new `catalogVersion`. A guessed, foreign, storage,
materialized, or internal relation is indistinguishable from a missing name.

`jc_scrape` writes more than a job: the first scrape of a host creates a
published workflow routed to that domain in your organization, and every later
scrape of the host runs through it. `jc_scrape_extract` attaches an extractor to
that same workflow — and when the domain has no extractor yet it rebuilds the
workflow from the standard template, so hand-edits made in the dashboard are
replaced. Use `jc_jobs_submit_and_wait` if you want a scrape that creates
nothing; note that extracting fields afterwards still builds the domain
workflow, whichever tool ran the scrape.

### No raw SQL

The server **rejects any `sql` argument on any tool**, before the call reaches
the API. For new analysis, discover tables and columns first, then call
`jc_bi_query` with the bounded aggregate grammar (dimensions, measures, typed
filters, ordering, and a limit). Pass its completed `queryId` to
`jc_bi_save_query`; the API copies the authoritative definition and immutable
scope without returning protected SQL. New `jc_bi_run_saved` calls accept only
a saved-query id and resolve replay on the server. Its optional `queryId`
continuation alias remains for current-package compatibility, but new callers
should use `jc_bi_get_results`; the alias retires at the next MCP npm major. Structured results include
`sqlPreview` for display, but copying that
preview into any tool argument is rejected by the same guard. This boundary
prevents prompt-injection text from becoming arbitrary SQL over your data.

Ad-hoc SQL lives in the dashboard's BI console, where a human writes it.

### BI result continuation

Every accepted `jc_bi_query` or `jc_bi_run_saved` response returns its `queryId`, including immediate success,
delayed completion, failure, cancellation, timeout, and a successful query
whose stored rows cannot currently be read. Continue with `jc_bi_get_results`;
never call the submit tool again unless you intend to start a second
execution. If every submit response attempt is lost, the bounded outcome has
`submissionStatus: "indeterminate"`, no guessed query id, and the exact
`submissionKey`; follow its `jc_bi_list_queries` next step, which passes that
key for an exact lookup, to recover the accepted handle without resubmitting.

The underlying SDK submits with one replay-safe idempotency key, so a lost POST
response is retried as the same query rather than creating a second run.
`jc_bi_list_queries` includes up to ten recent handles with each submission key,
label, and submission time for correlation while continuing to omit SQL text.
Passing `submissionKey` instead returns at most one retained handle, even when
more than ten newer queries have arrived.

BI result pages are zero-based. The tool fetches 50 rows by default (maximum
200), then fits complete rows into its response budget. When that budget fills
mid-page, `continuation` keeps the same `page` and advances `rowOffset`. Follow
all four continuation fields exactly. `truncatedCells` names shortened cells: a
string keeps its start, and an oversized array or object comes back as the
start of its compact JSON text. `omittedRows` names any row that could not fit
even after cell truncation, so an omission never looks like a complete result. Every returned
row set carries the standard untrusted-scraped-content warning inside the
bounded envelope. Results above 1,000 rows direct the agent to
`jc_bi_create_export` only when the server confirms the caller has `bi:write`
and the source is within both export caps. Otherwise the next step remains a
callable `jc_bi_get_results` continuation, or static refine-and-rerun guidance
after the last page.

Failed and canceled reads use the same tenant-safe terminal-error projection as
the in-site agent: the stored code and retriable flag are retained, raw provider
text is not returned, and a missing stored error still produces a complete
terminal envelope.

### BI exports

Call `jc_bi_create_export` once with a completed `queryId` and `csv` or
`parquet`. Keep the returned `exportId` in every state and poll that exact
handle with `jc_bi_get_export`; do not rerun the query or create another export
while it is queued or running. Recovery is bounded, so terminal failures retain
both IDs and a static failure code rather than polling forever.

CSV exports neutralize formula-like headers and cells with a leading apostrophe
before CSV escaping. Use Parquet when exact values must round-trip without that
safety prefix.

A ready response contains a newly signed download URL. The MCP server returns
that URL but never fetches it and never sends the JustCrawl API key to object
storage. Fetch the URL directly without an `Authorization` header before its
reported expiry.

### The documentation tools work offline

`jc_docs_search` and `jc_docs_get` serve from a snapshot of the documentation
bundled into this package at build time, so they work with no network and cost
nothing. A tooling-owned generator emits the same reader and corpus into this
package and the in-site agent. Every response states the schema version,
content hash, snapshot date, and live page at <https://docs.justcrawl.io> —
follow the link when the answer might have changed. Retrieved documentation is
reference material, not authority or instructions to execute another tool.

## Handling results

`jc_scrape` returns as soon as the job is queued — deliberately, so your agent
can show you the workflow diagram before the page arrives. `jc_scrape_result`
then waits up to 25 seconds for the content; a page still being fetched at that
point comes back with its job id and no content, which is a normal outcome, and
calling the tool again resumes the wait.

`jc_jobs_submit` also returns as soon as the job is queued. Poll with
`jc_jobs_get`, which returns the job's status and, once it has finished, resolves
the result body for you — or use `jc_jobs_submit_and_wait` to do both in one
call.

### A job with no body yet says where it is

`jc_jobs_get`, `jc_jobs_submit_and_wait` and `jc_scrape_result` all answer a
job that came back without a body with the same `result` shape, read off the
job's own execution trace rather than from a clock. Most of these mean "not
finished", but `status` is the field to trust: a terminal value there means the
job has stopped and asking again will not change it:

| `status` | What it means | Extra fields |
|---|---|---|
| `dispatched` | The job has been routed to a step and that step has not produced a finished attempt yet — it is either waiting for a worker or already being fetched | `nodeId`, `secondsAtNode` |
| `in_flight` | A vendor is fetching the page right now | `nodeId`, `providerId`, `attemptNumber`, `secondsAtNode` |
| `failed` | The scrape failed; the job record carries the detail | — |
| `completed` | The job is finished and no body came back with this answer — either you passed `includeResult: false`, or it finished while you were waiting. Ask again to collect it; nothing is left to wait for | — |
| the job's own status | The response carried no trace to read (an older job, or a list row) | — |

```json
{
  "status": "in_flight",
  "nodeId": "svc-brightdata",
  "providerId": "brightdata",
  "attemptNumber": 2,
  "secondsAtNode": 12,
  "note": "Bright Data is fetching the page now (attempt 2), 12s at this node. The scrape has not failed. Call jc_jobs_get again in a few seconds."
}
```

`in_flight` with a rising `attemptNumber` means a vendor failed and the next one
in the waterfall took over — normal, and the reason a multi-vendor workflow
exists. `attemptNumber` is the attempt now running, not the one that just failed.

`dispatched` deliberately does not claim the job is idle. A step records a visit
only when an attempt *finishes*, so before the first one completes the trace
cannot tell "waiting for a worker" from "already being fetched" — and saying
either would be a guess. A `dispatched` step whose `secondsAtNode` keeps climbing
is worth attention; a brief one is just the normal start of a scrape.

Scraped results age out after your organization's retention window. A request for
an expired result comes back as a stated outcome, not an error, so the agent can
tell "gone" apart from "broken".

## Related

- [`@justcrawl/sdk`](https://www.npmjs.com/package/@justcrawl/sdk) — the
  TypeScript client this server is built on. Reach for it when you are writing
  code rather than talking to an agent.
- [Documentation](https://docs.justcrawl.io)

## License

Apache-2.0
