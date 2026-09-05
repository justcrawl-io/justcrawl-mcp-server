# @justcrawl/mcp-server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for
[JustCrawl](https://justcrawl.io) — submit scrape jobs, browse workflows, run
saved BI queries, and search the docs from inside Claude Desktop, Cursor, or
Codex CLI.

It speaks MCP over **stdio**: your agent host spawns it as a local process, and
it talks to the JustCrawl REST API over HTTPS using your API key. Nothing runs on
JustCrawl's side that a `curl` with the same key could not do.

## Install

Nothing to install — your MCP host runs it with `npx`. You need **Node.js 20.3
or newer** and a JustCrawl API key (Settings → API Keys in the dashboard; it
starts with `sr_live_` and is shown once).

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
| `jc_urls_list` | List URLs in your library, filter by tag or search |
| `jc_bi_list_saved_queries` | List the BI saved queries you created in the dashboard |
| `jc_bi_run_saved` | Run one of those saved queries and return the first page of rows |
| `jc_schedules_list` | List your schedules |
| `jc_schedules_trigger` | Trigger a one-off run of a schedule |
| `jc_docs_search` | Search the JustCrawl documentation |
| `jc_docs_get` | Read one documentation page |

Six tools do something other than read: `jc_scrape`, `jc_scrape_extract`, `jc_jobs_submit`, `jc_jobs_submit_and_wait`, `jc_schedules_trigger`, and `jc_bi_run_saved` (it starts a run of a query you already saved, spending a BI concurrency slot). Everything else is read-only.
Nothing here can delete a workflow, a URL, or a schedule.

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
the API. `jc_bi_run_saved` takes the id of a query you already saved in the
dashboard and nothing else — there is no way to make the agent compose a query of
its own. This is a deliberate defense against prompt-injection-driven data
exfiltration: a malicious instruction hidden in a scraped page cannot turn into a
`SELECT` over your data.

Ad-hoc SQL lives in the dashboard's BI console, where a human writes it.

### The documentation tools work offline

`jc_docs_search` and `jc_docs_get` serve from a snapshot of the documentation
bundled into this package at build time, so they work with no network and cost
nothing. Every response states the snapshot date and links the live page at
<https://docs.justcrawl.io>, which is always current — follow the link when the
answer might have changed.

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
