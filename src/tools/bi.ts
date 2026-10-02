/** BI tools that discover data and execute safe structured or saved queries. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DEFAULT_STRUCTURED_LIMIT,
  MAX_STRUCTURED_DIMENSIONS,
  MAX_STRUCTURED_FILTERS,
  MAX_STRUCTURED_IN_VALUES,
  MAX_STRUCTURED_LIMIT,
  MAX_STRUCTURED_OUTPUT_FIELDS,
  STRUCTURED_QUERY_VERSION,
} from '../vendor/bi-structured-query.js';
import { z } from 'zod';

import * as log from '../log.js';
import { JustCrawlError } from '../sdk.js';
import type { ServerDeps } from '../server.js';
import {
  BI_RESULT_PAGE_SIZE,
  biRunOutputSchema,
  isRetryableBiReadError,
  isTerminalQueryStatus,
  notReadyResult,
  resultForStatus,
  safeErrorText,
  waitForTerminalQuery,
} from './bi-results.js';
import {
  MAX_RESULT_CHARS,
  run,
  structuredJsonResult,
  toolError,
  UNTRUSTED,
  waitTuning,
} from './helpers.js';

const schemaOutputSchema = z.object({
  catalogVersion: z.number().int().nonnegative(),
  restartRequired: z.boolean(),
  tables: z.array(
    z.object({
      name: z.string(),
      schema: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  returnedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  continuation: z.object({ cursor: z.string(), catalogVersion: z.number().int().nonnegative() }).nullable(),
  nextStep: z.object({
    tool: z.enum(['jc_bi_get_schema', 'none']),
    arguments: z.record(z.string(), z.union([z.string(), z.number()])),
    reason: z.string(),
  }),
});

const tableOutputSchema = z.object({
  name: z.string(),
  catalogVersion: z.number().int().nonnegative(),
  restartRequired: z.boolean(),
  contentWarning: z.string(),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      nullable: z.boolean(),
      description: z.string().optional(),
      sampleValues: z.array(z.unknown()).optional(),
    }),
  ),
  returnedCount: z.number().int().nonnegative(),
  omittedSampleCount: z.number().int().nonnegative(),
  omittedDescriptionCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  continuation: z.object({ name: z.string(), columnCursor: z.string(), catalogVersion: z.number().int().nonnegative() }).nullable(),
  nextStep: z.object({
    tool: z.enum(['jc_bi_get_table', 'jc_bi_get_schema', 'none']),
    arguments: z.record(z.string(), z.union([z.string(), z.number()])),
    reason: z.string(),
  }),
});

const savedQueryCreateOutputSchema = z.object({
  savedQueryId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  contentKind: z.enum(['sql', 'definition']),
  scopeKind: z.enum(['org', 'agent']),
  scopeAgentId: z.string().nullable(),
  sourceQueryId: z.string().nullable(),
  sqlPreview: z.string().nullable(),
});

const exportOutputSchema = z.object({
  exportId: z.string(),
  queryId: z.string(),
  format: z.enum(['csv', 'parquet']),
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  terminal: z.boolean(),
  reused: z.boolean().optional(),
  rowCount: z.number().int().nullable(),
  byteSize: z.number().int().nullable(),
  attemptGeneration: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  download: z.object({ url: z.string(), expiresInSec: z.number().int().positive() }).nullable(),
  nextStep: z.object({
    tool: z.enum(['jc_bi_get_export', 'none']),
    arguments: z.record(z.string(), z.string()),
    reason: z.string(),
  }),
});

const SAVED_QUERY_PAGE_SIZE = 10;
const MAX_SAVED_QUERY_DESCRIPTION_CHARS = 500;

const savedQueryListOutputSchema = z.object({
  savedQueries: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    descriptionTruncated: z.boolean(),
    contentKind: z.enum(['sql', 'definition']),
    scopeKind: z.enum(['org', 'agent']),
    scopeAgentId: z.string().nullable(),
    sourceQueryId: z.string().nullable(),
    sqlDialect: z.literal('postgres').nullable(),
    updatedAt: z.string(),
    isShared: z.boolean(),
    scheduleCount: z.number().int().nonnegative(),
  })),
  returnedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  continuation: z.object({ cursor: z.string() }).nullable(),
  nextStep: z.object({
    tool: z.enum(['jc_bi_list_saved_queries', 'jc_bi_run_saved', 'none']),
    arguments: z.record(z.string(), z.string()),
    reason: z.string(),
  }),
});

const structuredDimensionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('column'), column: z.string() }),
  z.object({
    kind: z.literal('time_bucket'),
    column: z.string(),
    granularity: z.enum(['day', 'week', 'month']),
  }),
]);

const structuredMeasureSchema = z.union([
  z.object({
    function: z.literal('count'),
    column: z.string().optional(),
    distinct: z.boolean().default(false),
  }),
  z.object({
    function: z.enum(['sum', 'average', 'minimum', 'maximum']),
    column: z.string(),
  }),
]);

const structuredFilterSchema = z.union([
  z.object({
    column: z.string(),
    operator: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']),
    value: z.union([z.string(), z.boolean()]),
  }),
  z.object({
    column: z.string(),
    operator: z.enum(['is_null', 'is_not_null']),
  }),
  z.object({
    column: z.string(),
    operator: z.literal('in'),
    values: z
      .array(z.union([z.string(), z.boolean()]))
      .min(1)
      .max(MAX_STRUCTURED_IN_VALUES),
  }),
]);

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Register saved-query discovery and execution tools. */
export function registerBiTools(server: McpServer, deps: ServerDeps): void {
  const { client } = deps;
  server.registerTool(
    'jc_bi_get_schema',
    {
      title: 'Discover BI tables',
      description:
        'List only the BI tables authorized for this organization. Continue with the returned name cursor and catalogVersion; restart when the catalog fingerprint changes.',
      inputSchema: {
        cursor: z.string().optional().describe('Last table name returned by the preceding response.'),
        catalogVersion: z.number().int().nonnegative().optional().describe('Fingerprint returned by the first response.'),
      },
      outputSchema: schemaOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ cursor, catalogVersion }) =>
      run('jc_bi_get_schema', async () => {
        const response = await client.bi.getSchema();
        const currentVersion = response.catalogVersion;
        if (catalogVersion !== undefined && catalogVersion !== currentVersion) {
          return structuredJsonResult({
            catalogVersion: currentVersion,
            restartRequired: true,
            tables: [],
            returnedCount: 0,
            hasMore: true,
            continuation: null,
            nextStep: {
              tool: 'jc_bi_get_schema',
              arguments: {},
              reason: 'The authorized catalog changed. Restart from the beginning with the new fingerprint.',
            },
          });
        }
        const tables = [...response.tables]
          .sort((a, b) => compareIdentifiers(a.name, b.name))
          .filter((table) => cursor === undefined || compareIdentifiers(table.name, cursor) > 0);
        return structuredJsonResult(boundCatalogPage(tables, currentVersion));
      }),
  );

  server.registerTool(
    'jc_bi_get_table',
    {
      title: 'Describe a BI table',
      description:
        'Return columns, types, and available organization-scoped samples for one table returned by jc_bi_get_schema. Unknown and unauthorized names are indistinguishable.',
      inputSchema: {
        name: z.string().describe('Exact table name returned by jc_bi_get_schema.'),
        columnCursor: z.string().optional().describe('Last column name returned by the preceding response.'),
        catalogVersion: z.number().int().nonnegative().optional().describe('Catalog fingerprint returned by discovery.'),
      },
      outputSchema: tableOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, columnCursor, catalogVersion }) =>
      run('jc_bi_get_table', async () => {
        const response = await client.bi.getTable(name);
        const currentVersion = response.catalogVersion;
        if (catalogVersion !== undefined && catalogVersion !== currentVersion) {
          return structuredJsonResult(restartTableResult(name, currentVersion));
        }
        const columns = [...response.columns]
          .sort((a, b) => compareIdentifiers(a.name, b.name))
          .filter(
            (column) =>
              columnCursor === undefined || compareIdentifiers(column.name, columnCursor) > 0,
          );
        return structuredJsonResult(boundTablePage(name, currentVersion, columns));
      }),
  );

  server.registerTool(
    'jc_bi_list_saved_queries',
    {
      title: 'List saved BI queries',
      description:
        'The BI queries saved in this organization, with their names and descriptions. Run one with ' +
        'jc_bi_run_saved, or save a completed jc_bi_query execution with jc_bi_save_query.',
      inputSchema: {
        cursor: z.string().optional().describe('Opaque cursor returned by the preceding page.'),
      },
      outputSchema: savedQueryListOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ cursor }) =>
      run('jc_bi_list_saved_queries', async () => {
        const response = await client.bi.listSavedQueries({
          limit: SAVED_QUERY_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (response.hasMore && !response.nextCursor) {
          return toolError('The saved-query list is incomplete but did not include a continuation cursor.');
        }

        const savedQueries = response.savedQueries.map((saved) => {
          const description = saved.description ?? null;
          return {
            id: saved.id,
            name: saved.name,
            description:
              description === null
                ? null
                : description.slice(0, MAX_SAVED_QUERY_DESCRIPTION_CHARS),
            descriptionTruncated:
              description !== null
              && description.length > MAX_SAVED_QUERY_DESCRIPTION_CHARS,
            contentKind: saved.contentKind,
            scopeKind: saved.scopeKind,
            scopeAgentId: saved.scopeAgentId,
            sourceQueryId: saved.sourceQueryId,
            sqlDialect: saved.sqlDialect,
            updatedAt: saved.updatedAt,
            isShared: saved.isShared,
            scheduleCount: saved.scheduleCount,
          };
        });

        const continuation = response.hasMore
          ? { cursor: response.nextCursor as string }
          : null;
        const firstSavedQuery = savedQueries[0];
        const nextStep = continuation !== null
          ? {
              tool: 'jc_bi_list_saved_queries' as const,
              arguments: continuation,
              reason: 'More saved queries are available. Continue with the returned cursor.',
            }
          : firstSavedQuery
            ? {
                tool: 'jc_bi_run_saved' as const,
                arguments: { id: firstSavedQuery.id },
                reason: 'Run a saved query by id without sending SQL.',
              }
            : {
                tool: 'none' as const,
                arguments: {},
                reason: 'No saved queries are available.',
              };

        return structuredJsonResult({
          savedQueries,
          returnedCount: savedQueries.length,
          hasMore: response.hasMore,
          continuation,
          nextStep,
        });
      }),
  );

  server.registerTool(
    'jc_bi_save_query',
    {
      title: 'Save a completed BI query',
      description:
        'Save one completed, organization-owned BI execution by source query id. The server copies its structured intent or private SQL and immutable scope; this tool never accepts SQL.',
      inputSchema: {
        sourceQueryId: z.string().describe('Completed queryId returned by jc_bi_query.'),
        name: z.string().min(1).max(120).describe('Unique saved-query name in this organization.'),
        description: z.string().max(1000).optional().describe('Optional explanation for dashboard users.'),
      },
      outputSchema: savedQueryCreateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ sourceQueryId, name, description }) =>
      run('jc_bi_save_query', async () => {
        const response = await client.bi.createSavedQuery({
          sourceQueryId,
          name,
          ...(description === undefined ? {} : { description }),
        });
        const saved = response.savedQuery;
        if (!saved?.id || !saved.name || !saved.contentKind || !saved.scopeKind) {
          return toolError('The query was saved but the API returned an incomplete saved-query record.');
        }
        return structuredJsonResult({
          savedQueryId: saved.id,
          name: saved.name,
          description: saved.description ?? null,
          contentKind: saved.contentKind,
          scopeKind: saved.scopeKind,
          scopeAgentId: saved.scopeAgentId ?? null,
          sourceQueryId: saved.sourceQueryId ?? null,
          sqlPreview: saved.sqlPreview ?? null,
        });
      }),
  );

  server.registerTool(
    'jc_bi_query',
    {
      title: 'Query BI data',
      description:
        'Run a safe aggregate query over one table returned by jc_bi_get_schema. Use exact table and column names from discovery. ' +
        'Numeric and timestamp filter values are strings; this tool never accepts SQL. The response includes display-only sqlPreview.',
      inputSchema: {
        table: z.string().describe('Exact table name returned by jc_bi_get_schema.'),
        dimensions: z
          .array(structuredDimensionSchema)
          .max(MAX_STRUCTURED_DIMENSIONS)
          .default([])
          .describe('Columns or day/week/month time buckets used to group the aggregate.'),
        measures: z
          .array(structuredMeasureSchema)
          .min(1)
          .max(MAX_STRUCTURED_OUTPUT_FIELDS)
          .describe('At least one count, sum, average, minimum, or maximum.'),
        filters: z
          .array(structuredFilterSchema)
          .max(MAX_STRUCTURED_FILTERS)
          .default([])
          .describe('AND-connected typed filters. Decimal and timestamp values are strings.'),
        order: z
          .object({
            field: z.string(),
            direction: z.enum(['ascending', 'descending']),
          })
          .nullable()
          .default(null)
          .describe('Optional ordering by a projected output alias.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_STRUCTURED_LIMIT)
          .default(DEFAULT_STRUCTURED_LIMIT),
        label: z.string().max(200).optional().describe('Optional human label for query history.'),
      },
      outputSchema: biRunOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ table, dimensions, measures, filters, order, limit, label }) =>
      run('jc_bi_query', async () => {
        const coordinate = { page: 0, pageSize: BI_RESULT_PAGE_SIZE, rowOffset: 0 };
        const tuning = waitTuning(deps.wait);
        const signal = AbortSignal.timeout(tuning.budgetMs);
        const submissionKey = globalThis.crypto.randomUUID();
        let submitted: Awaited<ReturnType<typeof client.bi.runStructuredQuery>>;
        try {
          submitted = await client.bi.runStructuredQuery(
            {
              definition: {
                version: STRUCTURED_QUERY_VERSION,
                table,
                dimensions,
                measures,
                filters,
                order,
                limit,
              },
              ...(label ? { label } : {}),
            },
            { signal, headers: { 'Idempotency-Key': submissionKey } },
          );
        } catch (err) {
          if (!isIndeterminateSubmissionError(err, signal)) throw err;
          log.error(`jc_bi_query: submission response lost: ${safeErrorText(err)}`);
          return indeterminateSubmissionResult(submissionKey);
        }
        if (typeof submitted.jobId !== 'string') {
          return toolError('The query was submitted but the API returned no run id.');
        }
        if (typeof submitted.sqlPreview !== 'string' || submitted.sqlPreview.length === 0) {
          return toolError('The structured query was submitted but the API returned no SQL preview.');
        }
        const runId = submitted.jobId;
        const sqlPreview = submitted.sqlPreview;
        if (isTerminalQueryStatus(submitted.status)) {
          return resultForStatus(client.bi, runId, submitted, coordinate, { signal, sqlPreview });
        }
        try {
          const settled = await waitForTerminalQuery(client.bi, runId, signal, tuning);
          if (settled) {
            return resultForStatus(client.bi, runId, settled, coordinate, { signal, sqlPreview });
          }
        } catch (err) {
          if (!signal.aborted) {
            log.error(`jc_bi_query: polling ${runId} failed: ${safeErrorText(err)}`);
          }
        }
        return notReadyResult(runId, submitted.status ?? 'running', coordinate, undefined, sqlPreview);
      }),
  );

  server.registerTool(
    'jc_bi_create_export',
    {
      title: 'Create a BI result export',
      description:
        'Create or reuse a CSV or Parquet file for one completed query. Poll the returned exportId with jc_bi_get_export; never resubmit the query.',
      inputSchema: {
        queryId: z.string().describe('Completed query id returned by a BI query tool.'),
        format: z.enum(['csv', 'parquet']).default('csv'),
      },
      outputSchema: exportOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ queryId, format }) =>
      run('jc_bi_create_export', async () => {
        const response = await client.bi.createExport(queryId, { format });
        return structuredJsonResult(projectExport(response.export, response.reused));
      }),
  );

  server.registerTool(
    'jc_bi_get_export',
    {
      title: 'Get a BI export',
      description:
        'Read one export status. A ready response returns a fresh presigned storage URL; this tool does not fetch that URL or send the JustCrawl API key to object storage.',
      inputSchema: {
        exportId: z.string().describe('Export id returned by jc_bi_create_export.'),
      },
      outputSchema: exportOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ exportId }) =>
      run('jc_bi_get_export', async () => {
        const response = await client.bi.getExport(exportId);
        return structuredJsonResult(projectExport(response.export));
      }),
  );

  server.registerTool(
    'jc_bi_run_saved',
    {
      title: 'Run a saved BI query',
      description:
        'Run one saved query by id. This server never accepts SQL and saved queries take no parameters. ' +
        'Accepted responses include the queryId; if every response attempt is lost, the outcome instead ' +
        'includes the submissionKey to match with jc_bi_list_queries. Passing a prior queryId is a compatibility alias for ' +
        'jc_bi_get_results and never submits again; prefer jc_bi_get_results for continuation.',
      inputSchema: {
        id: z.string().optional().describe('Saved-query id, from jc_bi_list_saved_queries. Required for a new run.'),
        queryId: z
          .string()
          .optional()
          .describe('Compatibility alias: resume this existing run exactly as jc_bi_get_results would.'),
      },
      outputSchema: biRunOutputSchema,
      // A new run spends query capacity; the queryId compatibility path does
      // not. No idempotent hint can accurately describe both branches.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ id, queryId }) =>
      run('jc_bi_run_saved', async () => {
        const coordinate = { page: 0, pageSize: BI_RESULT_PAGE_SIZE, rowOffset: 0 };
        const tuning = waitTuning(deps.wait);
        const signal = AbortSignal.timeout(tuning.budgetMs);
        if (queryId) {
          try {
            const status = await client.bi.getQuery(queryId, { signal });
            return resultForStatus(client.bi, queryId, status, coordinate, { signal });
          } catch (err) {
            if (!isRetryableBiReadError(err, signal)) throw err;
            log.error(`jc_bi_run_saved: checking ${queryId} failed: ${safeErrorText(err)}`);
            return notReadyResult(queryId, 'running', coordinate);
          }
        }
        if (!id) return toolError('A saved-query id is required when queryId is not supplied.');

        if (signal.aborted) return toolError('The tool deadline expired before the query could be submitted.');

        // Own this key above the SDK call so it survives an exhausted retry
        // ladder. Query history exposes the same key, allowing a later tool
        // invocation to recover an accepted run without resubmitting it.
        const submissionKey = globalThis.crypto.randomUUID();
        let submitted: Awaited<ReturnType<typeof client.bi.runSavedQuery>>;
        try {
          submitted = await client.bi.runSavedQuery(
            id,
            { signal, headers: { 'Idempotency-Key': submissionKey } },
          );
        } catch (err) {
          if (!isIndeterminateSubmissionError(err, signal)) throw err;
          log.error(`jc_bi_run_saved: submission response lost: ${safeErrorText(err)}`);
          return indeterminateSubmissionResult(submissionKey);
        }
        if (typeof submitted.jobId !== 'string') {
          return toolError('The query was submitted but the API returned no run id.');
        }
        const runId = submitted.jobId;
        const savedQueryName = typeof submitted.savedQueryName === 'string'
          ? submitted.savedQueryName
          : undefined;
        const sqlPreview = typeof submitted.sqlPreview === 'string'
          ? submitted.sqlPreview
          : undefined;
        // Immediate and delayed completion intentionally converge here. Even
        // when submit nested a first page, read zero-based page 0 through the
        // same endpoint used by every continuation so row identity cannot
        // depend on how quickly the engine finished.
        if (isTerminalQueryStatus(submitted.status)) {
          return resultForStatus(client.bi, runId, submitted, coordinate, {
            signal,
            savedQueryName,
            sqlPreview,
          });
        }

        try {
          const settled = await waitForTerminalQuery(client.bi, runId, signal, tuning);
          if (settled) {
            return resultForStatus(client.bi, runId, settled, coordinate, {
              signal,
              savedQueryName,
              sqlPreview,
            });
          }
        } catch (err) {
          if (!signal.aborted) {
            log.error(`jc_bi_run_saved: polling ${runId} failed: ${safeErrorText(err)}`);
          }
        }
        return notReadyResult(
          runId,
          submitted.status ?? 'running',
          coordinate,
          savedQueryName,
          sqlPreview,
        );
      }),
  );
}

function projectExport(
  value: {
    id?: string;
    queryId?: string;
    format?: 'csv' | 'parquet';
    status?: 'queued' | 'running' | 'ready' | 'failed';
    rowCount?: number | null;
    byteSize?: number | null;
    attemptGeneration?: number;
    attempts?: number;
    requestedAt?: string;
    startedAt?: string | null;
    completedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    downloadUrl?: string | null;
    downloadUrlExpiresInSec?: number | null;
  },
  reused?: boolean,
): Record<string, unknown> {
  if (!value.id || !value.queryId || !value.format || !value.status || !value.requestedAt) {
    throw new Error('The API returned an incomplete export record');
  }
  if (
    value.status === 'ready'
    && (
      !value.downloadUrl
      || !Number.isSafeInteger(value.downloadUrlExpiresInSec)
      || (value.downloadUrlExpiresInSec ?? 0) <= 0
    )
  ) {
    throw new Error('The API returned a ready export without a valid download');
  }
  const terminal = value.status === 'ready' || value.status === 'failed';
  return {
    exportId: value.id,
    queryId: value.queryId,
    format: value.format,
    status: value.status,
    terminal,
    ...(reused === undefined ? {} : { reused }),
    rowCount: value.rowCount ?? null,
    byteSize: value.byteSize ?? null,
    attemptGeneration: value.attemptGeneration ?? 0,
    attempts: value.attempts ?? 0,
    requestedAt: value.requestedAt,
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? null,
    error:
      value.status === 'failed'
        ? {
            code: value.errorCode ?? 'export_failed',
            message: value.errorMessage ?? 'The export failed.',
          }
        : null,
    download:
      value.status === 'ready' && value.downloadUrl
        ? {
            url: value.downloadUrl,
            expiresInSec: value.downloadUrlExpiresInSec,
          }
        : null,
    nextStep:
      terminal
        ? {
            tool: 'none',
            arguments: {},
            reason: value.status === 'ready'
              ? 'The export is ready. Download it with the returned presigned URL.'
              : 'The export failed terminally; retain the exportId when reporting the failure.',
          }
        : {
            tool: 'jc_bi_get_export',
            arguments: { exportId: value.id },
            reason: 'Poll this existing export handle; do not create another export.',
          },
  };
}

function boundCatalogPage(
  pending: Array<{ name: string; schema?: string; description?: string }>,
  catalogVersion: number,
): Record<string, unknown> {
  const tables: Array<{ name: string; schema?: string; description?: string }> = [];
  for (const table of pending) {
    tables.push(table);
    const output = catalogPage(catalogVersion, tables, tables.length < pending.length);
    if (JSON.stringify(output).length > MAX_RESULT_CHARS) {
      tables.pop();
      break;
    }
  }
  if (tables.length === 0 && pending.length > 0) {
    // Names are identifier-bounded by the gateway; this is a defensive guard
    // against a future contract widening that could otherwise return a stalled
    // empty continuation.
    throw new RangeError('A catalog entry cannot fit inside the tool response budget');
  }
  return catalogPage(catalogVersion, tables, tables.length < pending.length);
}

function catalogPage(
  catalogVersion: number,
  tables: Array<{ name: string; schema?: string; description?: string }>,
  hasMore: boolean,
): Record<string, unknown> {
  const cursor = hasMore ? tables.at(-1)?.name ?? null : null;
  return {
    catalogVersion,
    restartRequired: false,
    tables,
    returnedCount: tables.length,
    hasMore,
    continuation: cursor ? { cursor, catalogVersion } : null,
    nextStep: cursor
      ? {
          tool: 'jc_bi_get_schema',
          arguments: { cursor, catalogVersion },
          reason: 'Continue after the last returned table name without skipping a catalog member.',
        }
      : { tool: 'none', arguments: {}, reason: 'Every authorized table has been returned.' },
  };
}

function restartTableResult(name: string, catalogVersion: number): Record<string, unknown> {
  return {
    name,
    catalogVersion,
    restartRequired: true,
    contentWarning: UNTRUSTED,
    columns: [],
    returnedCount: 0,
    omittedSampleCount: 0,
    omittedDescriptionCount: 0,
    hasMore: true,
    continuation: null,
    nextStep: {
      tool: 'jc_bi_get_schema',
      arguments: {},
      reason: 'The authorized catalog changed. Restart discovery before describing a table.',
    },
  };
}

function boundTablePage(
  name: string,
  catalogVersion: number,
  pending: Array<{
    name: string;
    type: string;
    nullable: boolean;
    description?: string;
    sampleValues?: unknown[];
  }>,
): Record<string, unknown> {
  const columns: typeof pending = [];
  let omittedSampleCount = 0;
  let omittedDescriptionCount = 0;
  for (const source of pending) {
    let column = source;
    let sampleOmitted = false;
    let descriptionOmitted = false;
    columns.push(column);
    let candidate = tablePage(
      name,
      catalogVersion,
      columns,
      columns.length < pending.length,
      omittedSampleCount,
      omittedDescriptionCount,
    );
    if (JSON.stringify(candidate).length > MAX_RESULT_CHARS && column.sampleValues !== undefined) {
      const { sampleValues: _sampleValues, ...withoutSamples } = column;
      column = withoutSamples;
      columns[columns.length - 1] = column;
      sampleOmitted = true;
    }
    candidate = tablePage(
      name,
      catalogVersion,
      columns,
      columns.length < pending.length,
      omittedSampleCount + (sampleOmitted ? 1 : 0),
      omittedDescriptionCount,
    );
    if (JSON.stringify(candidate).length > MAX_RESULT_CHARS && column.description !== undefined) {
      const { description: _description, ...withoutDescription } = column;
      column = withoutDescription;
      columns[columns.length - 1] = column;
      descriptionOmitted = true;
    }
    candidate = tablePage(
      name,
      catalogVersion,
      columns,
      columns.length < pending.length,
      omittedSampleCount + (sampleOmitted ? 1 : 0),
      omittedDescriptionCount + (descriptionOmitted ? 1 : 0),
    );
    if (JSON.stringify(candidate).length > MAX_RESULT_CHARS) {
      columns.pop();
      break;
    }
    if (sampleOmitted) omittedSampleCount += 1;
    if (descriptionOmitted) omittedDescriptionCount += 1;
  }
  if (columns.length === 0 && pending.length > 0) {
    throw new RangeError('A column identity cannot fit inside the tool response budget');
  }
  return tablePage(
    name,
    catalogVersion,
    columns,
    columns.length < pending.length,
    omittedSampleCount,
    omittedDescriptionCount,
  );
}

function tablePage(
  name: string,
  catalogVersion: number,
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    description?: string;
    sampleValues?: unknown[];
  }>,
  hasMore: boolean,
  omittedSampleCount: number,
  omittedDescriptionCount: number,
): Record<string, unknown> {
  const columnCursor = hasMore ? columns.at(-1)?.name ?? null : null;
  return {
    name,
    catalogVersion,
    restartRequired: false,
    contentWarning: UNTRUSTED,
    columns,
    returnedCount: columns.length,
    omittedSampleCount,
    omittedDescriptionCount,
    hasMore,
    continuation: columnCursor ? { name, columnCursor, catalogVersion } : null,
    nextStep: columnCursor
      ? {
          tool: 'jc_bi_get_table',
          arguments: { name, columnCursor, catalogVersion },
          reason: 'Continue after the last returned column name; omitted samples or descriptions do not omit the column identity.',
        }
      : { tool: 'none', arguments: {}, reason: 'Every column name has been returned.' },
  };
}

function isIndeterminateSubmissionError(err: unknown, signal: AbortSignal): boolean {
  return (
    err instanceof JustCrawlError &&
    (((err.retryable === true || err.code === 'network_error') && err.status === 0) ||
      (err.retryable === true && err.status >= 500) ||
      (signal.aborted && err.status === 0 && err.code === 'network_error'))
  );
}

/** A bounded recovery coordinate for an accepted POST whose response was lost. */
function indeterminateSubmissionResult(submissionKey: string, savedQueryName?: string) {
  return structuredJsonResult({
    queryId: null,
    queryStatus: 'unknown',
    submissionStatus: 'indeterminate',
    submissionKey,
    resultStatus: 'not_ready',
    page: 0,
    pageSize: BI_RESULT_PAGE_SIZE,
    rowOffset: 0,
    totalRows: null,
    rows: [],
    returnedRowCount: 0,
    omittedRowCount: 0,
    truncatedCellCount: 0,
    omittedRows: [],
    truncatedCells: [],
    hasMore: false,
    continuation: null,
    nextStep: {
      tool: 'jc_bi_list_queries',
      arguments: { limit: 10, submissionKey },
      reason: 'Find the accepted query whose submissionKey matches this outcome, then continue its queryId.',
    },
    retryAdvice: 'Call jc_bi_list_queries with this submissionKey. Do not submit the query again.',
    ...(savedQueryName ? { savedQueryName } : {}),
  });
}
