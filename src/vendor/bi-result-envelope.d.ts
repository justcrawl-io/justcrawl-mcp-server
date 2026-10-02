import type { ResultHistoryCoverage } from './types.js';
/** One continuation coordinate inside a materialized BI result. */
export declare const BI_RESULT_MAX_CHARS = 20000;
export declare const BI_RESULT_MAX_CELL_CHARS = 4000;
export declare const BI_RESULT_PAGE_SIZE = 50;
export declare const BI_RESULT_PAGE_SIZE_MAX = 200;
export declare const UNTRUSTED_RESULT_CONTENT: string;
/** One continuation coordinate inside a materialized BI result. */
export interface ResultContinuation {
    queryId: string;
    /** Zero-based logical API page. */
    page: number;
    pageSize: number;
    /** Zero-based row offset inside `page`. */
    rowOffset: number;
}
/**
 * A cell that was shortened before its row was returned. A string cell keeps
 * its first characters. An array or object cell, such as a `text[]` or `jsonb`
 * value, is replaced by the start of its compact JSON text. Both end in `…`.
 */
export interface TruncatedResultCell {
    /** Zero-based row position across the complete materialized result. */
    rowIndex: number;
    column: string;
    /** Length of the original string, or of the array/object cell's compact JSON text. */
    originalChars: number;
    /** Length of the returned string, including the trailing `…`. */
    returnedChars: number;
}
/** A row that could not fit even after individual cells were bounded. */
export interface OmittedResultRow {
    /** Zero-based row position across the complete materialized result. */
    rowIndex: number;
    reason: 'row_exceeds_response_budget';
}
/** The next tool action suggested to an agent. */
export interface ResultNextStep {
    tool: 'jc_bi_get_results' | 'jc_bi_create_export' | 'queryAgentResults' | 'none';
    arguments: Record<string, string | number>;
    reason: string;
}
/** Callable action vocabulary used when presenting one shared result envelope. */
export type ResultEnvelopeActionSurface = 'mcp' | 'agent';
/** Server-derived ability to export one fixed materialized result. */
export interface ResultExportEligibility {
    /** True only when all permission and recorded-size checks pass. */
    eligible: boolean;
    /** Whether the current caller has the `bi:write` permission export creation requires. */
    hasWritePermission: boolean;
    /** Whether the materialized row count is within the server's export cap. */
    withinRowLimit: boolean;
    /** Whether the stored source byte size is within the server's export cap. */
    withinByteLimit: boolean;
}
/** A character-bounded, resumable view of one materialized result page. */
export interface BoundedResultEnvelope extends Record<string, unknown> {
    queryId: string;
    queryStatus: 'success';
    resultStatus: 'available';
    page: number;
    pageSize: number;
    rowOffset: number;
    totalRows: number;
    savedQueryName?: string;
    /** Display-only SQL compiled from structured intent. Never a continuation argument. */
    sqlPreview?: string;
    /** True when `sqlPreview` was shortened to preserve the response budget. */
    sqlPreviewTruncated?: boolean;
    /** Safety boundary for rows derived from third-party scraped content. */
    contentWarning?: string;
    /** Present when a structured aggregate left out readings older than its typed history. */
    historyCoverage?: ResultHistoryCoverage;
    rows: Record<string, unknown>[];
    returnedRowCount: number;
    omittedRowCount: number;
    truncatedCellCount: number;
    omittedRows: OmittedResultRow[];
    truncatedCells: TruncatedResultCell[];
    hasMore: boolean;
    continuation: ResultContinuation | null;
    nextStep: ResultNextStep;
}
/** Coordinates required to retry reading one already-admitted query. */
export interface ResultEnvelopeCoordinate {
    page: number;
    pageSize: number;
    rowOffset: number;
}
/** Shared non-success projection used by MCP and the in-site agent. */
export interface NonAvailableResultEnvelope extends Record<string, unknown> {
    queryId: string;
    queryStatus: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
    resultStatus: 'not_ready' | 'temporarily_unavailable' | 'unavailable';
    page: number;
    pageSize: number;
    rowOffset: number;
    totalRows: number | null;
    savedQueryName?: string;
    sqlPreview?: string;
    sqlPreviewTruncated?: boolean;
    rows: Record<string, unknown>[];
    returnedRowCount: 0;
    omittedRowCount: 0;
    truncatedCellCount: 0;
    omittedRows: [];
    truncatedCells: [];
    hasMore: boolean;
    continuation: ResultContinuation | null;
    nextStep: ResultNextStep;
    error?: {
        code?: string;
        retriable?: boolean;
        detail: string;
    };
    retryAdvice?: string;
}
/** Inputs common to durable non-success query reads. */
export interface BuildNonAvailableResultEnvelopeInput {
    queryId: string;
    queryStatus: NonAvailableResultEnvelope['queryStatus'];
    coordinate: ResultEnvelopeCoordinate;
    totalRows: number | null;
    savedQueryName?: string;
    sqlPreview?: string;
    maxChars: number;
    error?: NonAvailableResultEnvelope['error'];
    /** Action names available to the caller. Defaults to the public MCP surface. */
    actionSurface?: ResultEnvelopeActionSurface;
}
/** The surface-neutral result data that must agree across MCP and in-site reads. */
export type ResultEnvelopeData = Omit<BoundedResultEnvelope | NonAvailableResultEnvelope, 'nextStep'>;
/** Remove presentation-only action guidance before comparing result contracts. */
export declare function projectResultEnvelopeData(envelope: BoundedResultEnvelope | NonAvailableResultEnvelope): ResultEnvelopeData;
/**
 * Project a persisted/provider query failure to one static, tenant-safe shape.
 * Both MCP and the in-site agent use this function so the same durable handle
 * cannot expose different details or lose its retriable classification.
 */
export declare function projectResultQueryFailure(error?: {
    code?: string | null;
    retriable?: boolean | null;
} | null): NonNullable<NonAvailableResultEnvelope['error']>;
/** Inputs from one logical result page plus the response budget to enforce. */
export interface BuildResultEnvelopeInput {
    queryId: string;
    page: number;
    pageSize: number;
    rowOffset: number;
    totalRows: number;
    sourceHasMore: boolean;
    rows: Record<string, unknown>[];
    /** Optional saved-query identity that must fit inside the same budget. */
    savedQueryName?: string;
    /** Optional display-only SQL that must fit inside the same response budget. */
    sqlPreview?: string;
    /** Warning reserved beside untrusted result rows before row budgeting. */
    contentWarning?: string;
    /** Provider-reported pre-horizon exclusion, reserved before row budgeting. */
    historyCoverage?: ResultHistoryCoverage;
    /** Maximum length of the compact JSON serialization. */
    maxChars: number;
    /**
     * Maximum characters retained from one cell: a string's own characters, or
     * the compact JSON text of an array or object cell.
     */
    maxCellChars?: number;
    /** Prefer a file export when total rows exceed this MCP-visible threshold. */
    exportThresholdRows?: number;
    /** Eligibility derived by the result API from caller authority and source caps. */
    exportEligibility?: ResultExportEligibility;
    /** Action names available to the caller. Defaults to the public MCP surface. */
    actionSurface?: ResultEnvelopeActionSurface;
}
/** Serialize an envelope exactly as MCP mirrors it into text content. */
export declare function compactResultEnvelope(envelope: BoundedResultEnvelope): string;
/** Maximum display-only SQL retained in one bounded result response. */
export declare const MAX_SQL_PREVIEW_CHARS = 4000;
/** Bound display-only SQL while explicitly recording any truncation. */
export declare function projectSqlPreview(sqlPreview: string | undefined, maxChars: number): {
    sqlPreview?: string;
    sqlPreviewTruncated?: true;
};
/**
 * Build a response that reserves identity and continuation metadata before rows.
 *
 * Each cell above `maxCellChars` is shortened first and named in
 * `truncatedCells`. Array and object cells are measured by their compact JSON
 * text, so a wide `text[]` or `jsonb` value cannot push its row out of the
 * response.
 *
 * Rows are added whole. If another ordinary row would only overflow the
 * remaining space, it is left for the next response at the same page/offset.
 * If that row cannot fit in an otherwise-empty response even after cell
 * truncation, its absolute position is recorded as omitted and continuation
 * advances by one. This guarantees that every non-terminal response makes
 * progress without ever substring-truncating the serialized JSON object.
 */
export declare function buildResultEnvelope(input: BuildResultEnvelopeInput): BoundedResultEnvelope;
/** Build a resumable response for a query whose rows are not ready yet. */
export declare function buildNotReadyResultEnvelope(input: BuildNonAvailableResultEnvelopeInput): NonAvailableResultEnvelope;
/** Build a resumable response when a successful query's materialized rows cannot be read yet. */
export declare function buildTemporarilyUnavailableResultEnvelope(input: Omit<BuildNonAvailableResultEnvelopeInput, 'queryStatus'>): NonAvailableResultEnvelope;
/** Build a terminal response that cannot expose result rows. */
export declare function buildUnavailableResultEnvelope(input: BuildNonAvailableResultEnvelopeInput & {
    queryStatus: 'failed' | 'canceled';
}): NonAvailableResultEnvelope;
//# sourceMappingURL=result-envelope.d.ts.map