# MCP capability policy

This policy is the public inventory for the JustCrawl SDK resource methods and
the MCP tools that deliberately expose a subset of them. A `Direct` method has
at least one dedicated MCP tool. A `Composed` method is used inside a guided
tool, or its higher-level SDK convenience behavior is implemented by composing
the lower-level calls under the tool's tighter response deadline. `Not yet
built` means the API capability remains available through the SDK but does not
currently have an MCP contract. `Withheld` means MCP intentionally refuses the
capability.

The inventory covers public methods on the SDK's exported resource classes.
The client's generic `request` and `requestUnchecked` transports, API-key and
base-URL configuration, and credential-bearing provider-account operations are
withheld: MCP exposes only fixed, reviewed operations and never a generic HTTP
escape hatch. `jc_providers_list` uses that bounded client transport internally
for one fixed public-catalogue path; callers cannot choose its method or URL.
The published Agent conversation/card paths likewise remain generic-SDK-only:
MCP must not post a `save_query_offer` action because that endpoint represents
a real in-site human click, not model consent.

Omission reasons:

- N1 — operational or per-record diagnostics are deferred; this policy narrows
  the coverage claim instead of pretending those reads exist.
- N2 — benchmark lifecycle inspection and cancellation are not yet modeled for
  MCP.
- N3 — broader BI saved-query authoring and result-manifest detail are not yet
  built; the selected discovery, create, replay, result and export flows remain.
- N4 — extraction administration and history browsing are not yet built; the
  guided extraction flow exposes only the calls it needs.
- N5 — tenant backfill is AM-10 and explicitly outside this implementation.
- N6 — integration and storage configuration need a broader authoring policy
  before MCP can safely manage them.
- N7 — plan, transaction and recharge workflows remain dashboard/API tasks.
- N8 — general schedule read/update/delete management is not yet built beyond
  create, list, desired-state enable/disable and trigger.
- N9 — smart-workflow mode and suggestion management are not yet built.
- N10 — bulk and destructive URL-library management are not yet built beyond
  single create and list.
- N11 — webhook ingestion is a server-to-server callback, not a model-facing
  operation.
- N12 — general workflow authoring and publication are not yet built; guided
  scrape may create the existing automatic smart workflow.
- W1 — benchmark creation spends provider quota and MCP has no durable approval
  channel equivalent to the click-only benchmark card.
- W2 — raw SQL submission is withheld globally. MCP accepts only the structured
  grammar or already-saved queries, and its recursive SQL-key guard applies to
  every tool.
- W3 — Agent card-action POST is withheld. Save-offer acceptance is bound to a
  genuine current-user click in the Agent Playground; an MCP/model call cannot
  substitute for that authority. MCP's separate `jc_bi_save_query` flow remains
  API-key-authorized source-query saving and does not impersonate the card.

## SDK method dispositions

<!-- sdk-capability-policy:start -->
| SDK method | Disposition | Mapping or reason |
|---|---|---|
| `analytics.domains` | Not yet built | N1 — analytics diagnostics are deferred. |
| `analytics.matrix` | Not yet built | N1 — analytics diagnostics are deferred. |
| `analytics.overview` | Not yet built | N1 — analytics diagnostics are deferred. |
| `analytics.providers` | Not yet built | N1 — analytics diagnostics are deferred. |
| `analytics.timeseries` | Not yet built | N1 — analytics diagnostics are deferred. |
| `benchmarks.cancel` | Not yet built | N2 — benchmark lifecycle management is not modeled. |
| `benchmarks.create` | Withheld | W1 — provider-quota spend lacks a durable MCP approval channel. |
| `benchmarks.get` | Not yet built | N2 — benchmark lifecycle management is not modeled. |
| `benchmarks.latest` | Not yet built | N2 — benchmark lifecycle management is not modeled. |
| `benchmarks.results` | Not yet built | N2 — benchmark lifecycle management is not modeled. |
| `bi.cancelQuery` | Direct | `jc_bi_cancel_query` cancels and observes the terminal state. |
| `bi.convertSavedQueryToSql` | Not yet built | N3 — broader saved-query authoring is deferred. |
| `bi.createExport` | Direct | `jc_bi_create_export` creates a materialized result export. |
| `bi.createSavedQuery` | Direct | `jc_bi_save_query` saves a structured query definition. |
| `bi.deleteSavedQuery` | Not yet built | N3 — destructive saved-query management is deferred. |
| `bi.getExport` | Direct | `jc_bi_get_export` reads export state and delivery metadata. |
| `bi.getQuery` | Composed | `jc_bi_get_results`, `jc_bi_query`, `jc_bi_run_saved` and `jc_bi_cancel_query` inspect run state. |
| `bi.getResultManifest` | Not yet built | N3 — manifest-level result diagnostics are deferred. |
| `bi.getResults` | Direct | `jc_bi_get_results`, `jc_bi_query` and `jc_bi_run_saved` return bounded rows. |
| `bi.getSavedQuery` | Not yet built | N3 — saved-query detail is not yet modeled. |
| `bi.getSchema` | Direct | `jc_bi_get_schema` lists the authorized catalog. |
| `bi.getTable` | Direct | `jc_bi_get_table` describes one authorized table. |
| `bi.listQueries` | Direct | `jc_bi_list_queries` recovers recent query handles. |
| `bi.listSavedQueries` | Direct | `jc_bi_list_saved_queries` discovers saved queries. |
| `bi.runQuery` | Withheld | W2 — raw SQL submission is forbidden at the MCP boundary. |
| `bi.runSavedQuery` | Direct | `jc_bi_run_saved` submits an existing saved query. |
| `bi.runStructuredQuery` | Direct | `jc_bi_query` submits the bounded structured grammar. |
| `bi.updateSavedQuery` | Not yet built | N3 — broader saved-query authoring is deferred. |
| `extraction.backfill` | Not yet built | N5 — tenant backfill is explicitly outside this plan. |
| `extraction.deleteAttributes` | Not yet built | N4 — extraction administration is deferred. |
| `extraction.discover` | Composed | `jc_scrape_extract` discovers candidate extraction attributes. |
| `extraction.getAttributes` | Not yet built | N4 — extraction administration is deferred. |
| `extraction.getRawResult` | Not yet built | N4 — extraction result history is deferred. |
| `extraction.getResultById` | Not yet built | N4 — extraction result history is deferred. |
| `extraction.getResultByJob` | Composed | `jc_scrape_extract` and `jc_scrape_result` read the extraction tied to a job. |
| `extraction.getSchema` | Composed | `jc_scrape_extract` waits for and reads the discovered schema. |
| `extraction.listByUrlItem` | Not yet built | N4 — extraction result history is deferred. |
| `extraction.listResults` | Not yet built | N4 — extraction result history is deferred. |
| `extraction.listSchemas` | Not yet built | N4 — extraction schema browsing is deferred. |
| `extraction.setAttributes` | Not yet built | N4 — extraction administration is deferred. |
| `extraction.testXPath` | Not yet built | N1 — selector diagnostics are deferred. |
| `integrations.createInput` | Not yet built | N6 — integration authoring needs a broader policy. |
| `integrations.createOutput` | Not yet built | N6 — integration authoring needs a broader policy. |
| `integrations.deleteInput` | Not yet built | N6 — destructive integration management needs a broader policy. |
| `integrations.deleteOutput` | Not yet built | N6 — destructive integration management needs a broader policy. |
| `integrations.getStorage` | Not yet built | N6 — storage configuration is deferred. |
| `integrations.listInputs` | Not yet built | N6 — integration configuration is deferred. |
| `integrations.listInternalOutputs` | Not yet built | N6 — internal-output diagnostics are deferred. |
| `integrations.listOutputs` | Not yet built | N6 — integration configuration is deferred. |
| `integrations.setStorage` | Not yet built | N6 — storage configuration is deferred. |
| `integrations.toggleInput` | Not yet built | N6 — integration state management needs a broader policy. |
| `integrations.toggleOutput` | Not yet built | N6 — integration state management needs a broader policy. |
| `integrations.updateInput` | Not yet built | N6 — integration authoring needs a broader policy. |
| `integrations.updateOutput` | Not yet built | N6 — integration authoring needs a broader policy. |
| `jobs.batchStatus` | Not yet built | N1 — batch diagnostics are deferred. |
| `jobs.fetchResult` | Composed | `jc_jobs_get`, `jc_jobs_submit_and_wait` and `jc_scrape_result` fetch bounded results. |
| `jobs.get` | Direct | `jc_jobs_get`, `jc_jobs_submit_and_wait`, `jc_scrape_result` and `jc_scrape_extract` inspect job state. |
| `jobs.getResultPointer` | Composed | `jc_jobs_get`, `jc_jobs_submit_and_wait` and `jc_scrape_result` use it inside result fetching. |
| `jobs.list` | Direct | `jc_jobs_list` lists jobs. |
| `jobs.stats` | Not yet built | N1 — aggregate job diagnostics are deferred. |
| `jobs.submit` | Direct | `jc_jobs_submit`, `jc_jobs_submit_and_wait` and `jc_scrape` submit jobs. |
| `jobs.submitAndWait` | Composed | `jc_jobs_submit_and_wait` composes submit, bounded polling and result fetch under the MCP deadline. |
| `plans.rechargeRequestStatus` | Not yet built | N7 — recharge workflows remain dashboard/API tasks. |
| `plans.requestRecharge` | Not yet built | N7 — recharge workflows remain dashboard/API tasks. |
| `plans.status` | Not yet built | N7 — plan management remains a dashboard/API task. |
| `plans.transactions` | Not yet built | N7 — billing history remains a dashboard/API task. |
| `schedules.create` | Direct | `jc_schedules_create` creates recurring work. |
| `schedules.delete` | Not yet built | N8 — destructive schedule management is deferred. |
| `schedules.get` | Not yet built | N8 — schedule detail is not yet modeled. |
| `schedules.list` | Direct | `jc_schedules_list` lists recurring work. |
| `schedules.listRuns` | Not yet built | N1 — schedule-run diagnostics are deferred. |
| `schedules.toggle` | Direct | `jc_schedules_set_enabled` sends an explicit desired enabled state. |
| `schedules.trigger` | Direct | `jc_schedules_trigger` queues one immediate run. |
| `schedules.update` | Not yet built | N8 — general schedule editing is deferred. |
| `smartWorkflows.applySuggestion` | Not yet built | N9 — suggestion management is deferred. |
| `smartWorkflows.dismissSuggestion` | Not yet built | N9 — suggestion management is deferred. |
| `smartWorkflows.get` | Not yet built | N9 — smart-workflow management is deferred. |
| `smartWorkflows.listAllSuggestions` | Not yet built | N9 — suggestion diagnostics are deferred. |
| `smartWorkflows.listSuggestions` | Not yet built | N9 — suggestion diagnostics are deferred. |
| `smartWorkflows.setMode` | Not yet built | N9 — smart-workflow mode management is deferred. |
| `urls.create` | Direct | `jc_urls_create`, `jc_jobs_submit`, `jc_jobs_submit_and_wait` and `jc_scrape` create a missing URL item. |
| `urls.createBatch` | Not yet built | N10 — bulk URL-library management is deferred. |
| `urls.delete` | Not yet built | N10 — destructive URL-library management is deferred. |
| `urls.deleteBatch` | Not yet built | N10 — destructive bulk URL-library management is deferred. |
| `urls.get` | Not yet built | N10 — URL detail is not yet modeled. |
| `urls.list` | Direct | `jc_urls_list`, `jc_jobs_submit`, `jc_jobs_submit_and_wait` and `jc_scrape` discover URL items. |
| `urls.listExtractions` | Not yet built | N1 — per-URL extraction diagnostics are deferred. |
| `urls.listJobs` | Not yet built | N1 — per-URL job diagnostics are deferred. |
| `urls.toggle` | Not yet built | N10 — URL state management is deferred. |
| `urls.update` | Not yet built | N10 — URL editing is deferred. |
| `webhooks.ingest` | Not yet built | N11 — webhook ingestion is a server callback, not a model operation. |
| `workflows.clone` | Not yet built | N12 — general workflow authoring is deferred. |
| `workflows.create` | Not yet built | N12 — general workflow authoring is deferred. |
| `workflows.createDefaultSmart` | Composed | `jc_scrape` and `jc_scrape_extract` may create the standard automatic workflow. |
| `workflows.delete` | Not yet built | N12 — destructive workflow management is deferred. |
| `workflows.get` | Direct | `jc_workflows_get`, `jc_scrape` and `jc_scrape_extract` read a workflow. |
| `workflows.getVersion` | Not yet built | N12 — version-level workflow inspection is deferred. |
| `workflows.list` | Direct | `jc_workflows_list`, `jc_scrape` and `jc_scrape_extract` discover published workflows. |
| `workflows.publish` | Not yet built | N12 — workflow publication is deferred. |
| `workflows.setRouting` | Not yet built | N12 — workflow routing authoring is deferred. |
| `workflows.unpublish` | Not yet built | N12 — workflow publication management is deferred. |
| `workflows.update` | Not yet built | N12 — general workflow authoring is deferred. |
| `workflows.validate` | Not yet built | N12 — workflow-authoring diagnostics are deferred. |
<!-- sdk-capability-policy:end -->

## Registered MCP tools

The table is also machine-checked against the live registry. `SDK-backed` rows
list the resource methods they call or whose complete convenience behavior they
implement. `Local` rows are purpose-built MCP capabilities that do not map to a
public SDK resource method.

<!-- mcp-tool-policy:start -->
| MCP tool | Class | SDK methods or local source |
|---|---|---|
| `jc_bi_cancel_query` | SDK-backed | `bi.cancelQuery`, `bi.getQuery` |
| `jc_bi_create_export` | SDK-backed | `bi.createExport` |
| `jc_bi_get_export` | SDK-backed | `bi.getExport` |
| `jc_bi_get_results` | SDK-backed | `bi.getQuery`, `bi.getResults` |
| `jc_bi_get_schema` | SDK-backed | `bi.getSchema` |
| `jc_bi_get_table` | SDK-backed | `bi.getTable` |
| `jc_bi_list_queries` | SDK-backed | `bi.listQueries` |
| `jc_bi_list_saved_queries` | SDK-backed | `bi.listSavedQueries` |
| `jc_bi_query` | SDK-backed | `bi.runStructuredQuery`, `bi.getQuery`, `bi.getResults` |
| `jc_bi_run_saved` | SDK-backed | `bi.runSavedQuery`, `bi.getQuery`, `bi.getResults` |
| `jc_bi_save_query` | SDK-backed | `bi.createSavedQuery` |
| `jc_docs_get` | Local | Tooling-generated shared public documentation snapshot (bounded page + live citation + hash/version/date provenance) |
| `jc_docs_search` | Local | Tooling-generated shared public documentation snapshot (ranked search + live citations + hash/version/date provenance) |
| `jc_jobs_get` | SDK-backed | `jobs.get`, `jobs.fetchResult`, `jobs.getResultPointer` |
| `jc_jobs_list` | SDK-backed | `jobs.list` |
| `jc_jobs_submit` | SDK-backed | `jobs.submit`, `urls.create`, `urls.list` |
| `jc_jobs_submit_and_wait` | SDK-backed | `jobs.submitAndWait`, `jobs.submit`, `jobs.get`, `jobs.fetchResult`, `jobs.getResultPointer`, `urls.create`, `urls.list` |
| `jc_providers_list` | Local | Fixed public-catalogue GET through the bounded client transport |
| `jc_schedules_create` | SDK-backed | `schedules.create` |
| `jc_schedules_list` | SDK-backed | `schedules.list` |
| `jc_schedules_set_enabled` | SDK-backed | `schedules.toggle` |
| `jc_schedules_trigger` | SDK-backed | `schedules.trigger` |
| `jc_scrape` | SDK-backed | `jobs.submit`, `urls.create`, `urls.list`, `workflows.list`, `workflows.createDefaultSmart`, `workflows.get` |
| `jc_scrape_extract` | SDK-backed | `jobs.get`, `workflows.list`, `workflows.createDefaultSmart`, `workflows.get`, `extraction.discover`, `extraction.getSchema`, `extraction.getResultByJob` |
| `jc_scrape_result` | SDK-backed | `jobs.get`, `jobs.fetchResult`, `jobs.getResultPointer`, `extraction.getResultByJob` |
| `jc_urls_create` | SDK-backed | `urls.create` |
| `jc_urls_list` | SDK-backed | `urls.list` |
| `jc_workflows_get` | SDK-backed | `workflows.get` |
| `jc_workflows_list` | SDK-backed | `workflows.list` |
<!-- mcp-tool-policy:end -->

## Compatibility decision

`jc_bi_run_saved` keeps its optional `queryId` continuation alias throughout
the current `0.x` package line so existing hosts do not break. The alias will be
removed at the next MCP npm major. New callers must use `jc_bi_get_results` for
continuation; `jc_bi_run_saved` remains the submission tool for a saved-query
`id`. Until that major, its mixed read/write behavior intentionally carries no
`idempotentHint`.

Transport policy is unchanged: ordinary GET requests may be retried according
to the SDK retry policy. POST, PUT, PATCH and DELETE are never retried
transparently. The only narrow exception is the existing idempotency-keyed BI
submission path, whose key survives its retry ladder.
