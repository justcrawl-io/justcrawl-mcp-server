/** Current persisted structured aggregate definition version. */
export declare const STRUCTURED_QUERY_VERSION: 1;
/** Maximum number of projected dimension + measure fields. */
export declare const MAX_STRUCTURED_OUTPUT_FIELDS = 32;
/** Maximum grouping dimensions. */
export declare const MAX_STRUCTURED_DIMENSIONS = 8;
/** Maximum AND-connected predicates. */
export declare const MAX_STRUCTURED_FILTERS = 20;
/** Maximum members in one IN predicate. */
export declare const MAX_STRUCTURED_IN_VALUES = 100;
/** Default maximum number of materialized groups. */
export declare const DEFAULT_STRUCTURED_LIMIT = 100;
/** Hard maximum number of materialized groups. */
export declare const MAX_STRUCTURED_LIMIT = 10000;
/** The identifier rule already used by both BI flat-view DDL implementations. */
export declare const STRUCTURED_IDENTIFIER_RE: RegExp;
export type ClickHouseTypedTwinType = 'exact_numeric' | 'boolean' | 'text';
export type ClickHouseTypedTwinStorageKind = 'exact_numeric_twin' | 'exact_numeric_validity' | 'boolean_twin' | 'boolean_validity' | 'text_twin' | 'text_validity';
/** Durable metadata prefix stored in ClickHouse typed-twin column comments. */
export declare const CLICKHOUSE_TYPED_TWIN_COMMENT_PREFIX = "scraperoute_typed_twin_v1:";
/** Revision of the materialized projection; older pairs must be replayed before use. */
export declare const CLICKHOUSE_TYPED_TWIN_PROJECTION_VERSION = 2;
/** Projection provenance and bounded history coverage for one typed twin. */
export interface ClickHouseTypedTwinMetadata {
    sourceKey: string;
    storageKind: ClickHouseTypedTwinStorageKind;
    backfillHorizon: string;
    /** Absent on the original numeric/boolean projection. Retained for upgrade discovery. */
    projectionVersion?: number;
}
/**
 * Return the fixed ClickHouse typed-twin name for one logical attribute.
 * The semantic suffix is deliberately separate from customer-facing `_vN`
 * evolution. Long identifiers retain a deterministic hash so two names that
 * share the same truncated prefix cannot collide.
 */
export declare function clickhouseTypedTwinName(sourceColumn: string, type: ClickHouseTypedTwinType): string;
/** Return the fixed validity-companion name for one ClickHouse typed twin. */
export declare function clickhouseTypedTwinValidityName(sourceColumn: string, type: ClickHouseTypedTwinType): string;
/** Serialize typed-twin provenance into the stable ClickHouse column-comment format. */
export declare function serializeClickHouseTypedTwinMetadata(metadata: ClickHouseTypedTwinMetadata): string;
/** Parse a typed-twin column comment, returning null for legacy or malformed metadata. */
export declare function parseClickHouseTypedTwinMetadata(comment: string | null | undefined): ClickHouseTypedTwinMetadata | null;
/** Source semantics the structured compiler can preserve across BI engines. */
export type StructuredColumnType = 'text' | 'boolean' | 'exact_numeric' | 'timestamp';
/** One caller-visible field and its physical per-engine storage mapping. */
export interface StructuredCatalogColumn {
    name: string;
    type: StructuredColumnType;
    /** Actual key in normalized extraction JSON; version suffixes are never inferred. */
    sourceKey: string;
    postgresColumn: string;
    /** Typed ClickHouse storage twin. U16 populates this mapping. */
    clickhouseColumn?: string | null;
    /** Nullable Bool companion: false means an unsupported source token. */
    clickhouseValidityColumn?: string | null;
    /**
     * Completed typed-history horizon shared by the twin and its validity
     * companion. Readings created before it carry null typed values.
     */
    clickhouseBackfillHorizon?: string;
}
/** One authorized relation in a catalog snapshot. */
export interface StructuredCatalogTable {
    name: string;
    columns: StructuredCatalogColumn[];
}
/** Fresh, caller-authorized catalog supplied to the pure compiler. */
export interface StructuredQueryCatalog {
    catalogVersion: number;
    tables: StructuredCatalogTable[];
}
export type StructuredTimeGranularity = 'day' | 'week' | 'month';
export type StructuredOrderDirection = 'ascending' | 'descending';
export type NormalizedStructuredDimension = {
    kind: 'column';
    column: string;
    columnType: StructuredColumnType;
    sourceKey: string;
    alias: string;
} | {
    kind: 'time_bucket';
    column: string;
    columnType: 'timestamp';
    sourceKey: string;
    granularity: StructuredTimeGranularity;
    alias: string;
};
export type StructuredMeasureFunction = 'count' | 'sum' | 'average' | 'minimum' | 'maximum';
export type NormalizedStructuredMeasure = {
    function: 'count';
    column: null;
    distinct: false;
    alias: string;
} | {
    function: 'count';
    column: string;
    columnType: StructuredColumnType;
    sourceKey: string;
    distinct: boolean;
    alias: string;
} | {
    function: Exclude<StructuredMeasureFunction, 'count'>;
    column: string;
    columnType: 'exact_numeric';
    sourceKey: string;
    alias: string;
};
export type StructuredComparisonOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
export type StructuredNullOperator = 'is_null' | 'is_not_null';
export type NormalizedStructuredFilter = {
    column: string;
    columnType: StructuredColumnType;
    sourceKey: string;
    operator: StructuredComparisonOperator;
    value: string | boolean;
} | {
    column: string;
    columnType: StructuredColumnType;
    sourceKey: string;
    operator: StructuredNullOperator;
} | {
    column: string;
    columnType: StructuredColumnType;
    sourceKey: string;
    operator: 'in';
    values: Array<string | boolean>;
};
/** Strict, normalized v1 object persisted as bi_queries.definition. */
export interface NormalizedStructuredQueryV1 {
    version: typeof STRUCTURED_QUERY_VERSION;
    table: string;
    dimensions: NormalizedStructuredDimension[];
    measures: NormalizedStructuredMeasure[];
    filters: NormalizedStructuredFilter[];
    order: {
        field: string;
        direction: StructuredOrderDirection;
    } | null;
    limit: number;
}
/** Bound scalar values accepted by engine renderers. */
export type StructuredBindingValue = string | boolean | number;
/** Output representation guaranteed by a structured rendering. */
export type StructuredOutputType = StructuredColumnType | 'count' | 'decimal';
export interface RenderedStructuredQuery {
    text: string;
    values: StructuredBindingValue[];
    outputFields: Array<{
        alias: string;
        type: StructuredOutputType;
    }>;
    appliedLimit: number;
}
/** Engine-owned renderer fed only normalized intent and an authorized catalog. */
export interface StructuredQueryRenderer {
    readonly dialect: 'postgres' | 'clickhouse';
    render(definition: unknown, catalog: StructuredQueryCatalog): Promise<RenderedStructuredQuery>;
}
/** A stable validation failure for definitions, catalogs, and typed literals. */
export declare class StructuredQueryError extends Error {
    constructor(message: string);
}
/** Strictly validate an authorized structured-query catalog. */
export declare function validateStructuredQueryCatalog(input: unknown): StructuredQueryCatalog;
export interface ParsedDecimal38_9 {
    coefficient: bigint;
    scale: number;
    canonical: string;
}
/** Parse an exact Decimal(38,9) literal without a floating intermediate. */
export declare function parseDecimal38_9(input: unknown): ParsedDecimal38_9;
/**
 * Divide an exact decimal total by a positive count, returning nine fractional
 * digits with ties rounded half away from zero using bigint arithmetic only.
 */
export declare function averageDecimal38_9(total: string, count: bigint): string;
/**
 * Strictly parse and normalize a v1 aggregate definition against a supplied
 * authorized catalog. This function performs no I/O and never loads a catalog.
 */
export declare function normalizeStructuredQuery(input: unknown, catalogInput: StructuredQueryCatalog): NormalizedStructuredQueryV1;
/** Strictly validate a definition reloaded from JSONB without authorizing it. */
export declare function parseNormalizedStructuredQuery(input: unknown): NormalizedStructuredQueryV1;
/**
 * Compare a retried caller definition with a stored normalized definition
 * without consulting the current catalog. This keeps an already-accepted
 * idempotent submission replayable after catalog or feature-flag drift.
 */
export declare function isExactStructuredQueryReplay(input: unknown, persistedInput: unknown): boolean;
/**
 * Reauthorize a stored definition against a fresh catalog and reject any
 * removal, type change, or actual-source-key drift explicitly.
 */
export declare function assertStructuredQueryCatalogCompatibility(definitionInput: unknown, catalogInput: StructuredQueryCatalog): {
    definition: NormalizedStructuredQueryV1;
    table: StructuredCatalogTable;
};
//# sourceMappingURL=structured-query.d.ts.map