/** Current persisted structured aggregate definition version. */
export const STRUCTURED_QUERY_VERSION = 1;
/** Maximum number of projected dimension + measure fields. */
export const MAX_STRUCTURED_OUTPUT_FIELDS = 32;
/** Maximum grouping dimensions. */
export const MAX_STRUCTURED_DIMENSIONS = 8;
/** Maximum AND-connected predicates. */
export const MAX_STRUCTURED_FILTERS = 20;
/** Maximum members in one IN predicate. */
export const MAX_STRUCTURED_IN_VALUES = 100;
/** Default maximum number of materialized groups. */
export const DEFAULT_STRUCTURED_LIMIT = 100;
/** Hard maximum number of materialized groups. */
export const MAX_STRUCTURED_LIMIT = 10_000;
/** The identifier rule already used by both BI flat-view DDL implementations. */
export const STRUCTURED_IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
/** `Date#toISOString` shape: the only instant form renderers bind. */
const NORMALIZED_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Durable metadata prefix stored in ClickHouse typed-twin column comments. */
export const CLICKHOUSE_TYPED_TWIN_COMMENT_PREFIX = 'scraperoute_typed_twin_v1:';
/** Revision of the materialized projection; older pairs must be replayed before use. */
export const CLICKHOUSE_TYPED_TWIN_PROJECTION_VERSION = 2;
function stableIdentifierHash(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
/**
 * Return the fixed ClickHouse typed-twin name for one logical attribute.
 * The semantic suffix is deliberately separate from customer-facing `_vN`
 * evolution. Long identifiers retain a deterministic hash so two names that
 * share the same truncated prefix cannot collide.
 */
export function clickhouseTypedTwinName(sourceColumn, type) {
    if (!STRUCTURED_IDENTIFIER_RE.test(sourceColumn)) {
        throw new StructuredQueryError('typed twin source is not a safe SQL identifier');
    }
    const suffix = type === 'exact_numeric' ? '__decimal' : type === 'boolean' ? '__bool' : '__text';
    if (sourceColumn.length + suffix.length <= 63)
        return `${sourceColumn}${suffix}`;
    const hash = stableIdentifierHash(`${type}:${sourceColumn}`);
    const prefixLength = 63 - suffix.length - hash.length - 1;
    return `${sourceColumn.slice(0, prefixLength)}_${hash}${suffix}`;
}
/** Return the fixed validity-companion name for one ClickHouse typed twin. */
export function clickhouseTypedTwinValidityName(sourceColumn, type) {
    if (!STRUCTURED_IDENTIFIER_RE.test(sourceColumn)) {
        throw new StructuredQueryError('typed twin source is not a safe SQL identifier');
    }
    const suffix = type === 'exact_numeric' ? '__decimal_valid' : type === 'boolean' ? '__bool_valid' : '__text_valid';
    if (sourceColumn.length + suffix.length <= 63)
        return `${sourceColumn}${suffix}`;
    const hash = stableIdentifierHash(`validity:${type}:${sourceColumn}`);
    const prefixLength = 63 - suffix.length - hash.length - 1;
    return `${sourceColumn.slice(0, prefixLength)}_${hash}${suffix}`;
}
/** Serialize typed-twin provenance into the stable ClickHouse column-comment format. */
export function serializeClickHouseTypedTwinMetadata(metadata) {
    if (metadata.sourceKey.length === 0 || Number.isNaN(Date.parse(metadata.backfillHorizon))) {
        throw new StructuredQueryError('typed twin metadata is invalid');
    }
    return `${CLICKHOUSE_TYPED_TWIN_COMMENT_PREFIX}${JSON.stringify({
        ...metadata, projectionVersion: CLICKHOUSE_TYPED_TWIN_PROJECTION_VERSION,
    })}`;
}
/** Parse a typed-twin column comment, returning null for legacy or malformed metadata. */
export function parseClickHouseTypedTwinMetadata(comment) {
    if (!comment?.startsWith(CLICKHOUSE_TYPED_TWIN_COMMENT_PREFIX))
        return null;
    try {
        const parsed = JSON.parse(comment.slice(CLICKHOUSE_TYPED_TWIN_COMMENT_PREFIX.length));
        if (typeof parsed.sourceKey !== 'string'
            || parsed.sourceKey.length === 0
            || (parsed.storageKind !== 'exact_numeric_twin'
                && parsed.storageKind !== 'exact_numeric_validity'
                && parsed.storageKind !== 'boolean_twin'
                && parsed.storageKind !== 'boolean_validity'
                && parsed.storageKind !== 'text_twin'
                && parsed.storageKind !== 'text_validity')
            || typeof parsed.backfillHorizon !== 'string'
            || Number.isNaN(Date.parse(parsed.backfillHorizon))) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
/** A stable validation failure for definitions, catalogs, and typed literals. */
export class StructuredQueryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StructuredQueryError';
    }
}
function objectValue(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new StructuredQueryError(`${path} must be an object`);
    }
    return value;
}
function exactKeys(object, allowed, required, path) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(object)) {
        if (!allowedSet.has(key)) {
            throw new StructuredQueryError(`${path} has unknown field ${JSON.stringify(key)}`);
        }
    }
    for (const key of required) {
        if (!(key in object)) {
            throw new StructuredQueryError(`${path} is missing field ${JSON.stringify(key)}`);
        }
    }
}
function stringValue(value, path) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new StructuredQueryError(`${path} must be a non-empty string`);
    }
    return value;
}
function safeIdentifier(value, path) {
    const identifier = stringValue(value, path);
    if (!STRUCTURED_IDENTIFIER_RE.test(identifier)) {
        throw new StructuredQueryError(`${path} is not a safe SQL identifier`);
    }
    return identifier;
}
function arrayValue(value, path) {
    if (!Array.isArray(value)) {
        throw new StructuredQueryError(`${path} must be an array`);
    }
    return value;
}
function integerInRange(value, min, max, path) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new StructuredQueryError(`${path} must be an integer from ${min} through ${max}`);
    }
    return value;
}
function enumValue(value, allowed, path) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new StructuredQueryError(`${path} must be one of ${allowed.join(', ')}`);
    }
    return value;
}
function validateCatalogColumn(value, path) {
    const column = objectValue(value, path);
    exactKeys(column, [
        'name',
        'type',
        'sourceKey',
        'postgresColumn',
        'clickhouseColumn',
        'clickhouseValidityColumn',
        'clickhouseBackfillHorizon',
    ], ['name', 'type', 'sourceKey', 'postgresColumn'], path);
    const result = {
        name: safeIdentifier(column.name, `${path}.name`),
        type: enumValue(column.type, ['text', 'boolean', 'exact_numeric', 'timestamp'], `${path}.type`),
        sourceKey: stringValue(column.sourceKey, `${path}.sourceKey`),
        postgresColumn: safeIdentifier(column.postgresColumn, `${path}.postgresColumn`),
    };
    if (column.clickhouseColumn !== undefined) {
        result.clickhouseColumn = column.clickhouseColumn === null
            ? null
            : safeIdentifier(column.clickhouseColumn, `${path}.clickhouseColumn`);
    }
    if (column.clickhouseValidityColumn !== undefined) {
        result.clickhouseValidityColumn = column.clickhouseValidityColumn === null
            ? null
            : safeIdentifier(column.clickhouseValidityColumn, `${path}.clickhouseValidityColumn`);
    }
    if (column.clickhouseBackfillHorizon !== undefined) {
        const horizon = column.clickhouseBackfillHorizon;
        if (typeof horizon !== 'string' || !NORMALIZED_INSTANT_RE.test(horizon)) {
            throw new StructuredQueryError(`${path}.clickhouseBackfillHorizon must be a millisecond UTC ISO instant`);
        }
        result.clickhouseBackfillHorizon = horizon;
    }
    return result;
}
/** Strictly validate an authorized structured-query catalog. */
export function validateStructuredQueryCatalog(input) {
    const catalog = objectValue(input, 'catalog');
    exactKeys(catalog, ['catalogVersion', 'tables'], ['catalogVersion', 'tables'], 'catalog');
    const catalogVersion = integerInRange(catalog.catalogVersion, 0, Number.MAX_SAFE_INTEGER, 'catalog.catalogVersion');
    const tables = arrayValue(catalog.tables, 'catalog.tables').map((value, tableIndex) => {
        const path = `catalog.tables[${tableIndex}]`;
        const table = objectValue(value, path);
        exactKeys(table, ['name', 'columns'], ['name', 'columns'], path);
        const columns = arrayValue(table.columns, `${path}.columns`).map((column, columnIndex) => validateCatalogColumn(column, `${path}.columns[${columnIndex}]`));
        const names = new Set();
        for (const column of columns) {
            if (names.has(column.name)) {
                throw new StructuredQueryError(`${path} has duplicate column ${JSON.stringify(column.name)}`);
            }
            names.add(column.name);
        }
        return { name: safeIdentifier(table.name, `${path}.name`), columns };
    });
    const names = new Set();
    for (const table of tables) {
        if (names.has(table.name)) {
            throw new StructuredQueryError(`catalog has duplicate table ${JSON.stringify(table.name)}`);
        }
        names.add(table.name);
    }
    return { catalogVersion, tables };
}
function decimalFromParts(coefficient, scale) {
    const negative = coefficient < 0n;
    const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
    const unsigned = scale === 0
        ? digits
        : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    return negative && coefficient !== 0n ? `-${unsigned}` : unsigned;
}
/** Parse an exact Decimal(38,9) literal without a floating intermediate. */
export function parseDecimal38_9(input) {
    if (typeof input !== 'string' || !/^-?(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(input)) {
        throw new StructuredQueryError('exact numeric value must be a plain decimal string');
    }
    const negative = input.startsWith('-');
    const unsigned = negative ? input.slice(1) : input;
    const [integerPart, rawFraction = ''] = unsigned.split('.');
    if (rawFraction.length > 9) {
        throw new StructuredQueryError('exact numeric value exceeds Decimal(38,9) scale');
    }
    const significantInteger = integerPart.replace(/^0+/, '') || '0';
    if (significantInteger.length > 29) {
        throw new StructuredQueryError('exact numeric value exceeds Decimal(38,9) range');
    }
    const fraction = rawFraction.replace(/0+$/, '');
    const scale = fraction.length;
    const coefficientDigits = `${integerPart}${fraction}`.replace(/^0+/, '') || '0';
    const coefficient = BigInt(`${negative ? '-' : ''}${coefficientDigits}`);
    const canonical = decimalFromParts(coefficient, scale);
    // A 29-digit integer plus at most 9 fractional digits is Decimal(38,9).
    if (significantInteger.length + scale > 38) {
        throw new StructuredQueryError('exact numeric value exceeds Decimal(38,9) precision');
    }
    return { coefficient, scale, canonical };
}
/**
 * Divide an exact decimal total by a positive count, returning nine fractional
 * digits with ties rounded half away from zero using bigint arithmetic only.
 */
export function averageDecimal38_9(total, count) {
    if (count <= 0n) {
        throw new StructuredQueryError('average count must be positive');
    }
    const parsed = parseDecimal38_9(total);
    const scaledNumerator = parsed.coefficient * (10n ** BigInt(9 - parsed.scale));
    const negative = scaledNumerator < 0n;
    const magnitude = negative ? -scaledNumerator : scaledNumerator;
    let quotient = magnitude / count;
    const remainder = magnitude % count;
    if (remainder * 2n >= count)
        quotient += 1n;
    return decimalFromParts(negative ? -quotient : quotient, 9);
}
function normalizeTimestamp(value, path) {
    if (typeof value !== 'string') {
        throw new StructuredQueryError(`${path} must be an ISO-8601 timestamp with an explicit timezone`);
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) {
        throw new StructuredQueryError(`${path} must be an ISO-8601 timestamp with an explicit timezone`);
    }
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
        throw new StructuredQueryError(`${path} is not a valid timestamp`);
    }
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zoneText, offsetSign, offsetHourText, offsetMinuteText,] = match;
    const offsetMinutes = zoneText === 'Z'
        ? 0
        : (offsetSign === '+' ? 1 : -1)
            * ((Number(offsetHourText) * 60) + Number(offsetMinuteText));
    const local = new Date(timestamp.getTime() + (offsetMinutes * 60_000));
    const expectedMilliseconds = Number((fractionText ?? '').padEnd(3, '0') || '0');
    if (local.getUTCFullYear() !== Number(yearText)
        || local.getUTCMonth() + 1 !== Number(monthText)
        || local.getUTCDate() !== Number(dayText)
        || local.getUTCHours() !== Number(hourText)
        || local.getUTCMinutes() !== Number(minuteText)
        || local.getUTCSeconds() !== Number(secondText)
        || local.getUTCMilliseconds() !== expectedMilliseconds) {
        throw new StructuredQueryError(`${path} is not a valid timestamp`);
    }
    return timestamp.toISOString();
}
function normalizeScalar(value, type, path) {
    switch (type) {
        case 'text':
            if (typeof value !== 'string') {
                throw new StructuredQueryError(`${path} must be text`);
            }
            return value;
        case 'boolean':
            if (typeof value !== 'boolean') {
                throw new StructuredQueryError(`${path} must be boolean`);
            }
            return value;
        case 'exact_numeric':
            return parseDecimal38_9(value).canonical;
        case 'timestamp':
            return normalizeTimestamp(value, path);
    }
}
function aliasBase(base) {
    return base.slice(0, 63).replace(/_+$/, '') || 'result';
}
function allocateAlias(base, used, reserved) {
    const fitted = aliasBase(base);
    let candidate = reserved.has(fitted) ? aliasBase(`${fitted}__result`) : fitted;
    let suffix = 2;
    while (used.has(candidate) || reserved.has(candidate)) {
        const ending = `_${suffix}`;
        candidate = `${aliasBase(reserved.has(fitted) ? `${fitted}__result` : fitted).slice(0, 63 - ending.length)}${ending}`;
        suffix += 1;
    }
    used.add(candidate);
    return candidate;
}
function findAuthorizedTable(catalog, tableName) {
    const table = catalog.tables.find((candidate) => candidate.name === tableName);
    if (!table) {
        throw new StructuredQueryError(`table ${JSON.stringify(tableName)} is not authorized`);
    }
    return table;
}
function findColumn(table, name, path) {
    const column = table.columns.find((candidate) => candidate.name === name);
    if (!column) {
        throw new StructuredQueryError(`${path} names an unknown column`);
    }
    return column;
}
function normalizeDimension(input, table, usedAliases, reservedAliases, path) {
    const dimension = objectValue(input, path);
    const kind = enumValue(dimension.kind, ['column', 'time_bucket'], `${path}.kind`);
    if (kind === 'column') {
        exactKeys(dimension, ['kind', 'column'], ['kind', 'column'], path);
        const column = findColumn(table, safeIdentifier(dimension.column, `${path}.column`), path);
        // A direct dimension intentionally keeps its own source name. Generated
        // aliases still avoid every source name, including this one.
        const alias = usedAliases.has(column.name)
            ? allocateAlias(column.name, usedAliases, reservedAliases)
            : column.name;
        usedAliases.add(alias);
        return {
            kind,
            column: column.name,
            columnType: column.type,
            sourceKey: column.sourceKey,
            alias,
        };
    }
    exactKeys(dimension, ['kind', 'column', 'granularity'], ['kind', 'column', 'granularity'], path);
    const column = findColumn(table, safeIdentifier(dimension.column, `${path}.column`), path);
    if (column.type !== 'timestamp') {
        throw new StructuredQueryError(`${path} time bucket requires a timestamp column`);
    }
    const granularity = enumValue(dimension.granularity, ['day', 'week', 'month'], `${path}.granularity`);
    return {
        kind,
        column: column.name,
        columnType: 'timestamp',
        sourceKey: column.sourceKey,
        granularity,
        alias: allocateAlias(`${column.name}_${granularity}`, usedAliases, reservedAliases),
    };
}
function normalizeMeasure(input, table, usedAliases, reservedAliases, path) {
    const measure = objectValue(input, path);
    const fn = enumValue(measure.function, ['count', 'sum', 'average', 'minimum', 'maximum'], `${path}.function`);
    if (fn === 'count') {
        exactKeys(measure, ['function', 'column', 'distinct'], ['function'], path);
        const distinct = measure.distinct === undefined ? false : measure.distinct;
        if (typeof distinct !== 'boolean') {
            throw new StructuredQueryError(`${path}.distinct must be boolean`);
        }
        if (measure.column === undefined) {
            if (distinct) {
                throw new StructuredQueryError(`${path} count rows cannot be distinct`);
            }
            return {
                function: 'count',
                column: null,
                distinct: false,
                alias: allocateAlias('count_rows', usedAliases, reservedAliases),
            };
        }
        const column = findColumn(table, safeIdentifier(measure.column, `${path}.column`), path);
        return {
            function: 'count',
            column: column.name,
            columnType: column.type,
            sourceKey: column.sourceKey,
            distinct,
            alias: allocateAlias(`${distinct ? 'count_distinct' : 'count'}_${column.name}`, usedAliases, reservedAliases),
        };
    }
    exactKeys(measure, ['function', 'column'], ['function', 'column'], path);
    const column = findColumn(table, safeIdentifier(measure.column, `${path}.column`), path);
    if (column.type !== 'exact_numeric') {
        throw new StructuredQueryError(`${path} ${fn} requires an exact_numeric column`);
    }
    return {
        function: fn,
        column: column.name,
        columnType: 'exact_numeric',
        sourceKey: column.sourceKey,
        alias: allocateAlias(`${fn}_${column.name}`, usedAliases, reservedAliases),
    };
}
function normalizeFilter(input, table, path) {
    const filter = objectValue(input, path);
    const operator = enumValue(filter.operator, ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null', 'in'], `${path}.operator`);
    const column = findColumn(table, safeIdentifier(filter.column, `${path}.column`), path);
    const reference = {
        column: column.name,
        columnType: column.type,
        sourceKey: column.sourceKey,
    };
    if (operator === 'is_null' || operator === 'is_not_null') {
        exactKeys(filter, ['column', 'operator'], ['column', 'operator'], path);
        return { ...reference, operator };
    }
    if (operator === 'in') {
        exactKeys(filter, ['column', 'operator', 'values'], ['column', 'operator', 'values'], path);
        const values = arrayValue(filter.values, `${path}.values`);
        if (values.length === 0 || values.length > MAX_STRUCTURED_IN_VALUES) {
            throw new StructuredQueryError(`${path}.values must contain 1 through ${MAX_STRUCTURED_IN_VALUES} values`);
        }
        return {
            ...reference,
            operator,
            values: values.map((value, index) => normalizeScalar(value, column.type, `${path}.values[${index}]`)),
        };
    }
    exactKeys(filter, ['column', 'operator', 'value'], ['column', 'operator', 'value'], path);
    if (column.type === 'boolean' && operator !== 'eq' && operator !== 'neq') {
        throw new StructuredQueryError(`${path} boolean filters support only eq and neq`);
    }
    return {
        ...reference,
        operator,
        value: normalizeScalar(filter.value, column.type, `${path}.value`),
    };
}
/**
 * Strictly parse and normalize a v1 aggregate definition against a supplied
 * authorized catalog. This function performs no I/O and never loads a catalog.
 */
export function normalizeStructuredQuery(input, catalogInput) {
    const definition = objectValue(input, 'definition');
    exactKeys(definition, ['version', 'table', 'dimensions', 'measures', 'filters', 'order', 'limit'], ['version', 'table', 'measures'], 'definition');
    if (definition.version !== STRUCTURED_QUERY_VERSION) {
        throw new StructuredQueryError(`unsupported structured query version ${String(definition.version)}`);
    }
    const catalog = validateStructuredQueryCatalog(catalogInput);
    const tableName = safeIdentifier(definition.table, 'definition.table');
    const table = findAuthorizedTable(catalog, tableName);
    const dimensionInputs = definition.dimensions === undefined
        ? []
        : arrayValue(definition.dimensions, 'definition.dimensions');
    if (dimensionInputs.length > MAX_STRUCTURED_DIMENSIONS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_DIMENSIONS} dimensions`);
    }
    const measureInputs = arrayValue(definition.measures, 'definition.measures');
    if (measureInputs.length === 0) {
        throw new StructuredQueryError('definition requires at least one measure');
    }
    if (dimensionInputs.length + measureInputs.length > MAX_STRUCTURED_OUTPUT_FIELDS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_OUTPUT_FIELDS} output fields`);
    }
    const filterInputs = definition.filters === undefined
        ? []
        : arrayValue(definition.filters, 'definition.filters');
    if (filterInputs.length > MAX_STRUCTURED_FILTERS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_FILTERS} filters`);
    }
    const reservedAliases = new Set(table.columns.map((column) => column.name));
    const usedAliases = new Set();
    const dimensions = dimensionInputs.map((dimension, index) => normalizeDimension(dimension, table, usedAliases, reservedAliases, `definition.dimensions[${index}]`));
    const measures = measureInputs.map((measure, index) => normalizeMeasure(measure, table, usedAliases, reservedAliases, `definition.measures[${index}]`));
    const filters = filterInputs.map((filter, index) => normalizeFilter(filter, table, `definition.filters[${index}]`));
    let order = null;
    if (definition.order !== undefined && definition.order !== null) {
        const orderInput = objectValue(definition.order, 'definition.order');
        exactKeys(orderInput, ['field', 'direction'], ['field', 'direction'], 'definition.order');
        const field = safeIdentifier(orderInput.field, 'definition.order.field');
        if (!usedAliases.has(field)) {
            throw new StructuredQueryError('definition.order.field must name a declared output field');
        }
        order = {
            field,
            direction: enumValue(orderInput.direction, ['ascending', 'descending'], 'definition.order.direction'),
        };
    }
    return {
        version: STRUCTURED_QUERY_VERSION,
        table: tableName,
        dimensions,
        measures,
        filters,
        order,
        limit: definition.limit === undefined
            ? DEFAULT_STRUCTURED_LIMIT
            : integerInRange(definition.limit, 1, MAX_STRUCTURED_LIMIT, 'definition.limit'),
    };
}
function parseNormalizedReference(object, path) {
    return {
        column: safeIdentifier(object.column, `${path}.column`),
        columnType: enumValue(object.columnType, ['text', 'boolean', 'exact_numeric', 'timestamp'], `${path}.columnType`),
        sourceKey: stringValue(object.sourceKey, `${path}.sourceKey`),
    };
}
function parseNormalizedDimension(value, path) {
    const dimension = objectValue(value, path);
    const kind = enumValue(dimension.kind, ['column', 'time_bucket'], `${path}.kind`);
    if (kind === 'column') {
        exactKeys(dimension, ['kind', 'column', 'columnType', 'sourceKey', 'alias'], ['kind', 'column', 'columnType', 'sourceKey', 'alias'], path);
        return { kind, ...parseNormalizedReference(dimension, path), alias: safeIdentifier(dimension.alias, `${path}.alias`) };
    }
    exactKeys(dimension, ['kind', 'column', 'columnType', 'sourceKey', 'granularity', 'alias'], ['kind', 'column', 'columnType', 'sourceKey', 'granularity', 'alias'], path);
    const reference = parseNormalizedReference(dimension, path);
    if (reference.columnType !== 'timestamp') {
        throw new StructuredQueryError(`${path}.columnType must be timestamp`);
    }
    return {
        kind,
        column: reference.column,
        columnType: 'timestamp',
        sourceKey: reference.sourceKey,
        granularity: enumValue(dimension.granularity, ['day', 'week', 'month'], `${path}.granularity`),
        alias: safeIdentifier(dimension.alias, `${path}.alias`),
    };
}
function parseNormalizedMeasure(value, path) {
    const measure = objectValue(value, path);
    const fn = enumValue(measure.function, ['count', 'sum', 'average', 'minimum', 'maximum'], `${path}.function`);
    if (fn === 'count' && measure.column === null) {
        exactKeys(measure, ['function', 'column', 'distinct', 'alias'], ['function', 'column', 'distinct', 'alias'], path);
        if (measure.distinct !== false) {
            throw new StructuredQueryError(`${path}.distinct must be false for count rows`);
        }
        return { function: fn, column: null, distinct: false, alias: safeIdentifier(measure.alias, `${path}.alias`) };
    }
    if (fn === 'count') {
        exactKeys(measure, ['function', 'column', 'columnType', 'sourceKey', 'distinct', 'alias'], ['function', 'column', 'columnType', 'sourceKey', 'distinct', 'alias'], path);
        if (typeof measure.distinct !== 'boolean') {
            throw new StructuredQueryError(`${path}.distinct must be boolean`);
        }
        return {
            function: fn,
            ...parseNormalizedReference(measure, path),
            distinct: measure.distinct,
            alias: safeIdentifier(measure.alias, `${path}.alias`),
        };
    }
    exactKeys(measure, ['function', 'column', 'columnType', 'sourceKey', 'alias'], ['function', 'column', 'columnType', 'sourceKey', 'alias'], path);
    const reference = parseNormalizedReference(measure, path);
    if (reference.columnType !== 'exact_numeric') {
        throw new StructuredQueryError(`${path}.columnType must be exact_numeric`);
    }
    return {
        function: fn,
        column: reference.column,
        columnType: 'exact_numeric',
        sourceKey: reference.sourceKey,
        alias: safeIdentifier(measure.alias, `${path}.alias`),
    };
}
function parseNormalizedFilter(value, path) {
    const filter = objectValue(value, path);
    const operator = enumValue(filter.operator, ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'is_null', 'is_not_null', 'in'], `${path}.operator`);
    if (operator === 'is_null' || operator === 'is_not_null') {
        exactKeys(filter, ['column', 'columnType', 'sourceKey', 'operator'], ['column', 'columnType', 'sourceKey', 'operator'], path);
        return { ...parseNormalizedReference(filter, path), operator };
    }
    if (operator === 'in') {
        exactKeys(filter, ['column', 'columnType', 'sourceKey', 'operator', 'values'], ['column', 'columnType', 'sourceKey', 'operator', 'values'], path);
        const reference = parseNormalizedReference(filter, path);
        const values = arrayValue(filter.values, `${path}.values`);
        if (values.length === 0 || values.length > MAX_STRUCTURED_IN_VALUES) {
            throw new StructuredQueryError(`${path}.values must contain 1 through ${MAX_STRUCTURED_IN_VALUES} values`);
        }
        return {
            ...reference,
            operator,
            values: values.map((item, index) => {
                const normalized = normalizeScalar(item, reference.columnType, `${path}.values[${index}]`);
                if (normalized !== item)
                    throw new StructuredQueryError(`${path}.values[${index}] is not normalized`);
                return normalized;
            }),
        };
    }
    exactKeys(filter, ['column', 'columnType', 'sourceKey', 'operator', 'value'], ['column', 'columnType', 'sourceKey', 'operator', 'value'], path);
    const reference = parseNormalizedReference(filter, path);
    if (reference.columnType === 'boolean' && operator !== 'eq' && operator !== 'neq') {
        throw new StructuredQueryError(`${path} boolean filters support only eq and neq`);
    }
    const normalized = normalizeScalar(filter.value, reference.columnType, `${path}.value`);
    if (normalized !== filter.value) {
        throw new StructuredQueryError(`${path}.value is not normalized`);
    }
    return { ...reference, operator, value: normalized };
}
/** Strictly validate a definition reloaded from JSONB without authorizing it. */
export function parseNormalizedStructuredQuery(input) {
    const definition = objectValue(input, 'definition');
    exactKeys(definition, ['version', 'table', 'dimensions', 'measures', 'filters', 'order', 'limit'], ['version', 'table', 'dimensions', 'measures', 'filters', 'order', 'limit'], 'definition');
    if (definition.version !== STRUCTURED_QUERY_VERSION) {
        throw new StructuredQueryError(`unsupported structured query version ${String(definition.version)}`);
    }
    const dimensions = arrayValue(definition.dimensions, 'definition.dimensions').map((value, index) => parseNormalizedDimension(value, `definition.dimensions[${index}]`));
    if (dimensions.length > MAX_STRUCTURED_DIMENSIONS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_DIMENSIONS} dimensions`);
    }
    const measures = arrayValue(definition.measures, 'definition.measures').map((value, index) => parseNormalizedMeasure(value, `definition.measures[${index}]`));
    if (measures.length === 0)
        throw new StructuredQueryError('definition requires at least one measure');
    if (dimensions.length + measures.length > MAX_STRUCTURED_OUTPUT_FIELDS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_OUTPUT_FIELDS} output fields`);
    }
    const filters = arrayValue(definition.filters, 'definition.filters').map((value, index) => parseNormalizedFilter(value, `definition.filters[${index}]`));
    if (filters.length > MAX_STRUCTURED_FILTERS) {
        throw new StructuredQueryError(`definition supports at most ${MAX_STRUCTURED_FILTERS} filters`);
    }
    const aliases = [...dimensions, ...measures].map((field) => field.alias);
    if (new Set(aliases).size !== aliases.length) {
        throw new StructuredQueryError('definition output aliases must be unique');
    }
    let order = null;
    if (definition.order !== null) {
        const value = objectValue(definition.order, 'definition.order');
        exactKeys(value, ['field', 'direction'], ['field', 'direction'], 'definition.order');
        const field = safeIdentifier(value.field, 'definition.order.field');
        if (!aliases.includes(field)) {
            throw new StructuredQueryError('definition.order.field must name a declared output field');
        }
        order = {
            field,
            direction: enumValue(value.direction, ['ascending', 'descending'], 'definition.order.direction'),
        };
    }
    return {
        version: STRUCTURED_QUERY_VERSION,
        table: safeIdentifier(definition.table, 'definition.table'),
        dimensions,
        measures,
        filters,
        order,
        limit: integerInRange(definition.limit, 1, MAX_STRUCTURED_LIMIT, 'definition.limit'),
    };
}
function replayCatalog(definition) {
    const columns = new Map();
    for (const reference of referencesOf(definition)) {
        const existing = columns.get(reference.column);
        if (existing
            && (existing.type !== reference.columnType || existing.sourceKey !== reference.sourceKey)) {
            throw new StructuredQueryError(`stored definition has inconsistent metadata for column ${JSON.stringify(reference.column)}`);
        }
        columns.set(reference.column, {
            name: reference.column,
            type: reference.columnType,
            sourceKey: reference.sourceKey,
            postgresColumn: reference.column,
        });
    }
    return {
        catalogVersion: 0,
        tables: [{ name: definition.table, columns: [...columns.values()] }],
    };
}
function publicReplayIdentity(definition) {
    return {
        version: definition.version,
        table: definition.table,
        dimensions: definition.dimensions.map((dimension) => dimension.kind === 'column'
            ? { kind: dimension.kind, column: dimension.column }
            : {
                kind: dimension.kind,
                column: dimension.column,
                granularity: dimension.granularity,
            }),
        measures: definition.measures.map((measure) => measure.function === 'count'
            ? {
                function: measure.function,
                ...(measure.column === null ? {} : { column: measure.column }),
                distinct: measure.distinct,
            }
            : { function: measure.function, column: measure.column }),
        filters: definition.filters.map((filter) => {
            if ('values' in filter) {
                return { column: filter.column, operator: filter.operator, values: filter.values };
            }
            if ('value' in filter) {
                return { column: filter.column, operator: filter.operator, value: filter.value };
            }
            return { column: filter.column, operator: filter.operator };
        }),
        limit: definition.limit,
    };
}
/**
 * Compare a retried caller definition with a stored normalized definition
 * without consulting the current catalog. This keeps an already-accepted
 * idempotent submission replayable after catalog or feature-flag drift.
 */
export function isExactStructuredQueryReplay(input, persistedInput) {
    const persisted = parseNormalizedStructuredQuery(persistedInput);
    try {
        const raw = objectValue(input, 'definition');
        const { order: rawOrder, ...withoutOrder } = raw;
        const candidate = normalizeStructuredQuery(withoutOrder, replayCatalog(persisted));
        let order = null;
        if (rawOrder !== undefined && rawOrder !== null) {
            const value = objectValue(rawOrder, 'definition.order');
            exactKeys(value, ['field', 'direction'], ['field', 'direction'], 'definition.order');
            order = {
                field: safeIdentifier(value.field, 'definition.order.field'),
                direction: enumValue(value.direction, ['ascending', 'descending'], 'definition.order.direction'),
            };
        }
        return JSON.stringify(publicReplayIdentity(candidate))
            === JSON.stringify(publicReplayIdentity(persisted))
            && JSON.stringify(order) === JSON.stringify(persisted.order);
    }
    catch (err) {
        if (err instanceof StructuredQueryError)
            return false;
        throw err;
    }
}
function referencesOf(definition) {
    const values = [];
    for (const dimension of definition.dimensions)
        values.push(dimension);
    for (const measure of definition.measures) {
        if (measure.column !== null)
            values.push(measure);
    }
    for (const filter of definition.filters)
        values.push(filter);
    return values;
}
/**
 * Reauthorize a stored definition against a fresh catalog and reject any
 * removal, type change, or actual-source-key drift explicitly.
 */
export function assertStructuredQueryCatalogCompatibility(definitionInput, catalogInput) {
    const definition = parseNormalizedStructuredQuery(definitionInput);
    const catalog = validateStructuredQueryCatalog(catalogInput);
    const table = findAuthorizedTable(catalog, definition.table);
    for (const reference of referencesOf(definition)) {
        const current = table.columns.find((column) => column.name === reference.column);
        if (!current) {
            throw new StructuredQueryError(`catalog drift: column ${JSON.stringify(reference.column)} is unavailable`);
        }
        if (current.type !== reference.columnType || current.sourceKey !== reference.sourceKey) {
            throw new StructuredQueryError(`catalog drift: column ${JSON.stringify(reference.column)} changed type or source mapping`);
        }
    }
    return { definition, table };
}
//# sourceMappingURL=structured-query.js.map