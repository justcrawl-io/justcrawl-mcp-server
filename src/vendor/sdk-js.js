// ../../types/error-types/dist/index.js
var JUSTCRAWL_MEDIA_TYPE = "application/vnd.justcrawl.v1+json";
var STATIC_MESSAGES = {
  auth_missing: "Authentication required. Provide a bearer token or API key.",
  auth_invalid: "The provided credentials are invalid, expired, or revoked.",
  auth_forbidden: "You do not have permission to perform this action.",
  auth_org_mismatch: "The resource belongs to a different organization.",
  invalid_url: "The URL is malformed or missing a scheme. Use https:// or http://.",
  invalid_workflow: "The workflow JSON is malformed or fails DAG validation.",
  invalid_input: "One or more request fields are missing or malformed.",
  node_type_unknown: "The workflow uses an unrecognized node type.",
  not_found: "The requested resource does not exist.",
  workflow_disabled: "The workflow is disabled. Re-enable it before submitting jobs.",
  org_not_found: "The organization does not exist or is not accessible.",
  quota_exceeded: "Rate limit or quota exceeded. Slow down or contact support to raise it.",
  plan_required: "This feature requires a higher plan tier.",
  payment_required: "Payment is required. Update billing in the dashboard to continue.",
  conflict: "The request conflicts with the current state of the resource.",
  already_exists: "A resource with that identifier already exists.",
  job_terminal: "The job is already in a terminal state and cannot be modified.",
  auth_code_expired: "The authorization code has expired. Start a new CLI login flow.",
  auth_code_consumed: "The authorization code has already been used. Start a new CLI login flow.",
  provider_unavailable: "The upstream scraping provider is temporarily unavailable.",
  internal_error: "An unexpected error occurred. The team has been notified.",
  service_unavailable: "The service is temporarily unavailable. Try again shortly."
};
function isJustcrawlErrorCode(code) {
  return Object.prototype.hasOwnProperty.call(STATIC_MESSAGES, code);
}

// src/errors.ts
var JustCrawlError = class extends Error {
  status;
  code;
  inferredCode;
  shape;
  requestId;
  raw;
  docsUrl;
  param;
  retryAfterSeconds;
  /**
   * Whether retrying this exact request could succeed — `false` on a POST (no
   * `Idempotency-Key` exists, so a retry charges a second credit), `false` on a
   * 402, `true` on a 429/5xx/network failure to a GET.
   *
   * Read this instead of switching on `status` yourself: the SDK's own retry
   * loop is driven by the same predicates, so the two cannot disagree.
   */
  retryable;
  /** Set only on the 402 quota shape. */
  remainingCredits;
  isTrialExpired;
  plan;
  constructor(init) {
    super(init.message);
    this.name = "JustCrawlError";
    this.status = init.status;
    this.code = init.code;
    this.inferredCode = init.inferredCode;
    this.shape = init.shape;
    this.requestId = init.requestId;
    this.raw = init.raw;
    this.docsUrl = init.docsUrl;
    this.param = init.param;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.retryable = init.retryable;
    this.remainingCredits = init.remainingCredits;
    this.isTrialExpired = init.isTrialExpired;
    this.plan = init.plan;
  }
};
var JustCrawlTimeoutError = class extends JustCrawlError {
  constructor(timeoutMs, requestId, retryable) {
    super({
      message: `Request timed out after ${timeoutMs}ms`,
      status: 0,
      code: "timeout",
      inferredCode: true,
      shape: "transport",
      requestId,
      retryable
    });
    this.name = "JustCrawlTimeoutError";
  }
};
var JustCrawlConnectionError = class extends JustCrawlError {
  constructor(cause, retryable) {
    super({
      message: `Could not reach the JustCrawl API: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 0,
      code: "network_error",
      inferredCode: true,
      shape: "transport",
      retryable
    });
    this.name = "JustCrawlConnectionError";
    this.cause = cause;
  }
};
var JustCrawlAbortError = class extends JustCrawlError {
  constructor() {
    super({
      message: "Request aborted by the caller",
      status: 0,
      code: "network_error",
      inferredCode: true,
      shape: "transport"
    });
    this.name = "JustCrawlAbortError";
  }
};
function inferCodeFromStatus(status) {
  switch (status) {
    case 400:
      return "invalid_input";
    case 401:
      return "auth_invalid";
    case 403:
      return "auth_forbidden";
    case 402:
      return "payment_required";
    case 404:
    case 410:
      return "not_found";
    case 409:
      return "conflict";
    // No member of the server's closed enum covers rate limiting — see
    // JustCrawlErrorCode. Flagged as inferred, so it can never be mistaken for
    // something the server said.
    case 429:
      return "rate_limited";
    case 503:
      return "service_unavailable";
    default:
      return status >= 500 ? "internal_error" : "invalid_input";
  }
}
var NON_JSON_SNIPPET_MAX = 500;
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function errorFromResponse(status, bodyText, requestId, retryAfterSeconds, retryable) {
  let parsed;
  try {
    parsed = bodyText.length > 0 ? JSON.parse(bodyText) : void 0;
  } catch {
    parsed = void 0;
  }
  const body = asRecord(parsed);
  const base = { status, requestId, retryAfterSeconds, retryable };
  if (body === void 0) {
    const snippet = bodyText.trim().slice(0, NON_JSON_SNIPPET_MAX);
    return new JustCrawlError({
      ...base,
      message: snippet.length > 0 ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`,
      code: status >= 500 ? "internal_error" : inferCodeFromStatus(status),
      inferredCode: true,
      shape: "non-json",
      raw: bodyText.length > 0 ? snippet : void 0
    });
  }
  const nested = asRecord(body.error);
  if (nested !== void 0 && typeof nested.code === "string") {
    return new JustCrawlError({
      ...base,
      message: typeof nested.message === "string" ? nested.message : `HTTP ${status}`,
      // Used verbatim — this is a code the server actually stated, whether or
      // not it is a member of the shared enum (BI carries its own vocabulary:
      // invalid_sql, feature_disabled, saved_query_name_taken, …).
      code: nested.code,
      inferredCode: false,
      shape: "structured",
      requestId: typeof nested.request_id === "string" ? nested.request_id : requestId,
      docsUrl: typeof nested.docs_url === "string" ? nested.docs_url : void 0,
      param: typeof nested.param === "string" ? nested.param : void 0,
      raw: parsed
    });
  }
  if (typeof body.error === "string") {
    if (body.error === "QUOTA_EXCEEDED") {
      return new JustCrawlError({
        ...base,
        message: typeof body.message === "string" ? body.message : "Insufficient credits",
        code: "quota_exceeded",
        // The server named QUOTA_EXCEEDED explicitly; `quota_exceeded` is that
        // same code in the shared enum's casing, not an inference.
        inferredCode: false,
        shape: "quota",
        raw: parsed,
        remainingCredits: typeof body.remainingCredits === "number" ? body.remainingCredits : void 0,
        isTrialExpired: typeof body.isTrialExpired === "boolean" ? body.isTrialExpired : void 0,
        plan: typeof body.plan === "string" ? body.plan : void 0
      });
    }
    const looksLikeCode = isJustcrawlErrorCode(body.error);
    return new JustCrawlError({
      ...base,
      message: body.error,
      code: looksLikeCode ? body.error : inferCodeFromStatus(status),
      inferredCode: !looksLikeCode,
      shape: "flat",
      raw: parsed
    });
  }
  return new JustCrawlError({
    ...base,
    message: `HTTP ${status}`,
    code: inferCodeFromStatus(status),
    inferredCode: true,
    shape: "non-json",
    raw: parsed
  });
}

// src/retry.ts
var RETRYABLE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD"]);
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
var DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 3e4
};
function isRetryableResponse(method, status) {
  if (!RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  return RETRYABLE_STATUSES.has(status);
}
function isRetryableTransportError(method) {
  return RETRYABLE_METHODS.has(method.toUpperCase());
}
function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === void 0) return void 0;
  const trimmed = value.trim();
  if (trimmed.length === 0) return void 0;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^[+-]?[\d.]+$/.test(trimmed)) return void 0;
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return void 0;
  return Math.max(0, Math.round((asDate - now) / 1e3));
}
function computeDelayMs(attempt, retryAfterSeconds, policy = DEFAULT_RETRY_POLICY, random = Math.random) {
  if (retryAfterSeconds !== void 0) {
    return Math.min(retryAfterSeconds * 1e3, policy.maxDelayMs);
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.round(exponential * random());
}

// src/resources/base.ts
var Resource = class {
  constructor(client) {
    this.client = client;
  }
  /**
   * Narrow a generated query-parameter object to the transport's loose
   * `QueryParams`.
   *
   * The generated types describe each endpoint's parameters precisely (literal
   * unions for enums, `number` for pages); `buildQueryString` accepts the general
   * shape. The two are structurally compatible but TypeScript will not infer the
   * widening across an index signature, so the cast happens once here rather than
   * ~99 times at the call sites — and stays visible as a single reviewable seam.
   */
  q(query) {
    return query;
  }
  /**
   * Forward per-call options (`signal`, `timeoutMs`, `headers`) without repeating
   * the spread.
   *
   * Generic in `extra` on purpose. `request()`'s options type is now narrowed per
   * operation — `path` is required for a templated endpoint and `path?: never`
   * for a flat one — so a helper returning the loose `RequestOptions` would be
   * rejected at every one of the ~101 call sites. Preserving `extra`'s literal
   * type lets the narrowed shape survive the merge.
   */
  opts(options, extra) {
    return { ...options, ...extra };
  }
};

// src/resources/analytics.ts
var AnalyticsResource = class extends Resource {
  /** Headline counters: jobs, success rate, spend. */
  overview(query, options) {
    return this.client.request(
      "get",
      "/api/v1/analytics/overview",
      this.opts(options, { query: this.q(query) })
    );
  }
  /** Bucketed series over the window; `interval` picks the bucket width. */
  timeseries(query, options) {
    return this.client.request(
      "get",
      "/api/v1/analytics/timeseries",
      this.opts(options, { query: this.q(query) })
    );
  }
  /** Per-provider success rate, latency, and cost. */
  providers(query, options) {
    return this.client.request(
      "get",
      "/api/v1/analytics/providers",
      this.opts(options, { query: this.q(query) })
    );
  }
  /** Top domains by volume. */
  domains(query, options) {
    return this.client.request(
      "get",
      "/api/v1/analytics/domains",
      this.opts(options, { query: this.q(query) })
    );
  }
  /** The domain × provider grid — which vendor actually works where. */
  matrix(query, options) {
    return this.client.request(
      "get",
      "/api/v1/analytics/matrix",
      this.opts(options, { query: this.q(query) })
    );
  }
};

// src/resources/benchmarks.ts
var BenchmarksResource = class extends Resource {
  /**
   * Start a benchmark run.
   *
   * Benchmarks scrape for real, so this spends provider quota. It also `503`s
   * rather than charging when the platform credentials for a provider are unset.
   */
  create(body, options) {
    return this.client.request("post", "/api/v1/benchmarks", this.opts(options, { body }));
  }
  /** The most recent completed benchmark for the org. */
  latest(options) {
    return this.client.request("get", "/api/v1/benchmarks/latest", options);
  }
  get(id, options) {
    return this.client.request("get", "/api/v1/benchmarks/{id}", this.opts(options, { path: { id } }));
  }
  /** Stop a run in flight — the cheapest way to cap a benchmark's spend. */
  cancel(id, options) {
    return this.client.request(
      "post",
      "/api/v1/benchmarks/{id}/cancel",
      this.opts(options, { path: { id } })
    );
  }
  results(id, options) {
    return this.client.request(
      "get",
      "/api/v1/benchmarks/{id}/results",
      this.opts(options, { path: { id } })
    );
  }
};

// src/resources/bi.ts
var BiResource = class extends Resource {
  /** The queryable schema: tables and columns available to this org. */
  getSchema(options) {
    return this.client.request("get", "/api/v1/bi/schema", options);
  }
  /** Column detail for one table. */
  getTable(name, options) {
    return this.client.request("get", "/api/v1/bi/tables/{name}", this.opts(options, { path: { name } }));
  }
  /**
   * Submit a SQL query. Answers `429` (`too_many_queries`) when the org already
   * has too many in flight — a GET would be retried, but this POST is not.
   */
  runQuery(body, options) {
    return this.client.request("post", "/api/v1/bi/queries", this.opts(options, { body }));
  }
  /** Recent query runs. */
  listQueries(query, options) {
    return this.client.request("get", "/api/v1/bi/queries", this.opts(options, { query: this.q(query) }));
  }
  /** One query run: status, timing, and error detail if it failed. */
  getQuery(id, options) {
    return this.client.request("get", "/api/v1/bi/queries/{id}", this.opts(options, { path: { id } }));
  }
  /** Row count, column list, and page count — cheaper than fetching page 1. */
  getResultManifest(id, options) {
    return this.client.request(
      "get",
      "/api/v1/bi/queries/{id}/result-manifest",
      this.opts(options, { path: { id } })
    );
  }
  /** One page of results. `pageSize` caps at 100 — pages, never a stream. */
  getResults(id, query, options) {
    return this.client.request(
      "get",
      "/api/v1/bi/queries/{id}/results",
      this.opts(options, { query: this.q(query), path: { id } })
    );
  }
  cancelQuery(id, options) {
    return this.client.request(
      "post",
      "/api/v1/bi/queries/{id}/cancel",
      this.opts(options, { path: { id } })
    );
  }
  listSavedQueries(options) {
    return this.client.request("get", "/api/v1/bi/saved-queries", options);
  }
  createSavedQuery(body, options) {
    return this.client.request("post", "/api/v1/bi/saved-queries", this.opts(options, { body }));
  }
  /** One saved query, including its `sql` — the first half of "run a saved query". */
  getSavedQuery(id, options) {
    return this.client.request("get", "/api/v1/bi/saved-queries/{id}", this.opts(options, { path: { id } }));
  }
  updateSavedQuery(id, body, options) {
    return this.client.request(
      "patch",
      "/api/v1/bi/saved-queries/{id}",
      this.opts(options, { body, path: { id } })
    );
  }
  deleteSavedQuery(id, options) {
    return this.client.request(
      "delete",
      "/api/v1/bi/saved-queries/{id}",
      this.opts(options, { path: { id } })
    );
  }
  /** Start an export of a completed query's results. */
  createExport(queryId, body, options) {
    return this.client.request(
      "post",
      "/api/v1/bi/queries/{id}/exports",
      this.opts(options, { body, path: { id: queryId } })
    );
  }
  /** Export status and, once ready, its download pointer. */
  getExport(exportId, options) {
    return this.client.request(
      "get",
      "/api/v1/bi/exports/{exportId}",
      this.opts(options, { path: { exportId } })
    );
  }
};

// src/resources/extraction.ts
var ExtractionResource = class extends Resource {
  /** Recent extraction results across the org, optionally filtered by domain. */
  listResults(query, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/results",
      this.opts(options, { query: this.q(query) })
    );
  }
  /**
   * The extraction result for one job.
   *
   * **A `202` here is not a result.** When the job is in `extraction_done` but
   * the bulk-writer has not flushed yet, the API answers `202` with an
   * `indexingPending` body and a `Retry-After: 5` header. `polling.ts` models
   * that as its own outcome; this method returns the body as the spec types it,
   * so check before treating it as an `ExtractionResult`.
   */
  getResultByJob(jobId, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/results/{jobId}",
      this.opts(options, { path: { jobId } })
    );
  }
  /** One extraction result by its own id (not the job's). */
  getResultById(id, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/results/by-id/{id}",
      this.opts(options, { path: { id } })
    );
  }
  /** The raw captured HTML behind an extraction result. */
  getRawResult(id, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/results/{id}/raw",
      this.opts(options, { path: { id } })
    );
  }
  /** Discovered XPath schemas, filterable by domain and page type. */
  listSchemas(query, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/schemas",
      this.opts(options, { query: this.q(query) })
    );
  }
  /**
   * One domain's schema for a page type.
   *
   * `pageType` is the spec's own enum rather than a bare `string`, derived here
   * so it cannot drift: it was `string` until the typed `request()` refused it,
   * which meant a caller could ask for a page type the API has never had and
   * find out only from the 404.
   */
  getSchema(domain, pageType, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/schemas/{domain}/{pageType}",
      this.opts(options, { path: { domain, pageType } })
    );
  }
  /** Custom attributes configured for a domain. */
  getAttributes(domain, query, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/attributes/{domain}",
      this.opts(options, { query: this.q(query), path: { domain } })
    );
  }
  /** Replace a domain's custom attributes wholesale. */
  setAttributes(domain, body, options) {
    return this.client.request(
      "put",
      "/api/v1/extraction/attributes/{domain}",
      this.opts(options, { body, path: { domain } })
    );
  }
  deleteAttributes(domain, query, options) {
    return this.client.request(
      "delete",
      "/api/v1/extraction/attributes/{domain}",
      this.opts(options, { query: this.q(query), path: { domain } })
    );
  }
  /** Try an XPath against captured HTML without running a job. */
  testXPath(body, options) {
    return this.client.request("post", "/api/v1/extraction/test-xpath", this.opts(options, { body }));
  }
  /**
   * Re-extract from already-captured HTML.
   *
   * Cheap relative to re-scraping — but bounded by blob retention: keys past the
   * org's `document_expiry_days` come back `blob_expired`, not re-fetched.
   */
  backfill(body, options) {
    return this.client.request("post", "/api/v1/extraction/backfill", this.opts(options, { body }));
  }
  /**
   * Ensure a schema covering the named attributes exists for a scraped job's
   * domain, then re-extract that job through it.
   *
   * Returns `202` immediately — the work is asynchronous. Poll
   * {@link getSchema} for the schema and {@link getResultByJob} for this job's
   * values (`waitForExtractionResult` in `polling.ts` does the latter).
   *
   * Like {@link backfill}, this reads the job's cached HTML and never re-hits
   * the provider, so it is bounded by blob retention: a job whose body is past
   * the org's `document_expiry_days` answers `410` rather than re-scraping.
   */
  discover(body, options) {
    return this.client.request("post", "/api/v1/extraction/discover", this.opts(options, { body }));
  }
  /** Extraction history for one URL item. */
  listByUrlItem(urlItemId, query, options) {
    return this.client.request(
      "get",
      "/api/v1/extraction/urls/{urlItemId}/extractions",
      this.opts(options, { query: this.q(query), path: { urlItemId } })
    );
  }
};

// src/resources/integrations.ts
var IntegrationsResource = class extends Resource {
  listInputs(options) {
    return this.client.request("get", "/api/v1/integrations/inputs", options);
  }
  createInput(body, options) {
    return this.client.request("post", "/api/v1/integrations/inputs", this.opts(options, { body }));
  }
  updateInput(id, body, options) {
    return this.client.request(
      "put",
      "/api/v1/integrations/inputs/{id}",
      this.opts(options, { body, path: { id } })
    );
  }
  deleteInput(id, options) {
    return this.client.request(
      "delete",
      "/api/v1/integrations/inputs/{id}",
      this.opts(options, { path: { id } })
    );
  }
  toggleInput(id, body, options) {
    return this.client.request(
      "patch",
      "/api/v1/integrations/inputs/{id}/toggle",
      this.opts(options, { body, path: { id } })
    );
  }
  listOutputs(options) {
    return this.client.request("get", "/api/v1/integrations/outputs", options);
  }
  createOutput(body, options) {
    return this.client.request("post", "/api/v1/integrations/outputs", this.opts(options, { body }));
  }
  /** Platform-managed outputs — readable, not editable by the customer. */
  listInternalOutputs(options) {
    return this.client.request("get", "/api/v1/integrations/outputs/internal", options);
  }
  updateOutput(id, body, options) {
    return this.client.request(
      "put",
      "/api/v1/integrations/outputs/{id}",
      this.opts(options, { body, path: { id } })
    );
  }
  deleteOutput(id, options) {
    return this.client.request(
      "delete",
      "/api/v1/integrations/outputs/{id}",
      this.opts(options, { path: { id } })
    );
  }
  toggleOutput(id, body, options) {
    return this.client.request(
      "patch",
      "/api/v1/integrations/outputs/{id}/toggle",
      this.opts(options, { body, path: { id } })
    );
  }
  /** The org's blob storage configuration (bucket, prefix, retention). */
  getStorage(options) {
    return this.client.request("get", "/api/v1/integrations/storage", options);
  }
  setStorage(body, options) {
    return this.client.request("put", "/api/v1/integrations/storage", this.opts(options, { body }));
  }
};

// src/sleep.ts
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new JustCrawlAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new JustCrawlAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// src/types.ts
var TERMINAL_JOB_STATUSES = ["completed", "failed"];
var NON_TERMINAL_JOB_STATUSES = [
  "pending",
  "running",
  "waiting_retry",
  "extracting",
  "extraction_done"
];
function isTerminalStatus(status) {
  return TERMINAL_JOB_STATUSES.includes(status);
}

// src/polling.ts
var DEFAULTS = {
  maxWaitMs: 5 * 6e4,
  initialIntervalMs: 1e3,
  maxIntervalMs: 15e3
};
var JobWaitTimeoutError = class extends JustCrawlError {
  jobId;
  lastStatus;
  elapsedMs;
  constructor(jobId, lastStatus, elapsedMs) {
    super({
      // The last-seen status is the whole diagnostic value here: "still pending"
      // after two minutes means a queue backlog, while "running" means a slow
      // provider. A bare "timed out" would throw that distinction away.
      message: `Job ${jobId} did not reach a terminal status within ${elapsedMs}ms (last status: ${lastStatus ?? "unknown"})`,
      status: 0,
      code: "timeout",
      inferredCode: true,
      shape: "transport"
    });
    this.name = "JobWaitTimeoutError";
    this.jobId = jobId;
    this.lastStatus = lastStatus;
    this.elapsedMs = elapsedMs;
  }
};
async function waitForJob(client, jobId, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? DEFAULTS.maxWaitMs;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULTS.maxIntervalMs;
  let interval = options.initialIntervalMs ?? DEFAULTS.initialIntervalMs;
  const startedAt = Date.now();
  let lastStatus;
  for (; ; ) {
    if (options.signal?.aborted === true) throw new JustCrawlAbortError();
    let remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);
    const budget = AbortSignal.timeout(remaining);
    const pollSignal = options.signal === void 0 ? budget : AbortSignal.any([options.signal, budget]);
    let job;
    try {
      job = await client.jobs.get(jobId, {
        signal: pollSignal,
        timeoutMs: Math.min(options.timeoutMs ?? client.timeoutMs, remaining),
        headers: options.headers
      });
    } catch (err) {
      if (err instanceof JustCrawlAbortError && !budget.aborted) throw err;
      remaining = maxWaitMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);
      await sleep(Math.min(interval, remaining), options.signal);
      interval = Math.min(interval * 2, maxIntervalMs);
      continue;
    }
    const elapsedMs = Date.now() - startedAt;
    lastStatus = job.status;
    options.onPoll?.(job, elapsedMs);
    if (typeof job.status === "string" && isTerminalStatus(job.status)) return job;
    remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);
    await sleep(Math.min(interval, remaining), options.signal);
    interval = Math.min(interval * 2, maxIntervalMs);
  }
}
async function fetchJobResult(client, jobId, options = {}) {
  let pointer;
  try {
    pointer = await client.jobs.getResultPointer(jobId, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      headers: options.headers
    });
  } catch (err) {
    if (err instanceof JustCrawlError && err.status === 410) {
      const raw = err.raw;
      return { kind: "expired", expiredAt: raw?.expiredAt };
    }
    throw err;
  }
  const meta = {
    providerId: pointer.providerId ?? "",
    statusCode: pointer.statusCode ?? 0,
    bodySize: pointer.bodySize ?? 0,
    latencyMs: pointer.latencyMs ?? 0
  };
  if (typeof pointer.blobKey === "string") {
    return { kind: "blob", blobKey: pointer.blobKey, ...meta };
  }
  if (typeof pointer.resultUrl !== "string") {
    throw new JustCrawlError({
      message: `Result for job ${jobId} carried neither resultUrl nor blobKey`,
      status: 0,
      code: "internal_error",
      inferredCode: true,
      shape: "transport",
      raw: pointer
    });
  }
  const doFetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? client.timeoutMs;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal === void 0 ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal]);
  const typedError = (err) => {
    if (options.signal?.aborted === true) return new JustCrawlAbortError();
    if (timeoutSignal.aborted) return new JustCrawlTimeoutError(timeoutMs);
    return new JustCrawlConnectionError(err);
  };
  let response;
  try {
    response = await doFetch(pointer.resultUrl, { signal });
  } catch (err) {
    throw typedError(err);
  }
  if (!response.ok) {
    throw new JustCrawlError({
      message: `Could not download the result body for job ${jobId} (HTTP ${response.status})`,
      status: response.status,
      code: response.status === 403 ? "auth_forbidden" : "internal_error",
      inferredCode: true,
      shape: "transport"
    });
  }
  let data;
  try {
    data = await response.text();
  } catch (err) {
    throw typedError(err);
  }
  return { kind: "url", data, ...meta };
}
function isIndexingPending(value) {
  return typeof value === "object" && value !== null && value.indexingPending === true;
}
async function waitForExtractionResult(client, jobId, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? DEFAULTS.maxWaitMs;
  const startedAt = Date.now();
  for (; ; ) {
    if (options.signal?.aborted === true) throw new JustCrawlAbortError();
    const body = await client.extraction.getResultByJob(jobId, { signal: options.signal });
    if (!isIndexingPending(body)) return body;
    const remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, "extraction_done", Date.now() - startedAt);
    const asked = Number(body.retryAfterSeconds);
    const serverAsked = Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1e3, options.maxIntervalMs ?? DEFAULTS.maxIntervalMs) : options.initialIntervalMs ?? DEFAULTS.initialIntervalMs;
    await sleep(Math.min(serverAsked, remaining), options.signal);
  }
}

// src/resources/jobs.ts
var JobsResource = class extends Resource {
  /**
   * Paginated list of jobs in the org.
   *
   * Heavy fields (`executionTrace`, `nodeState`) are stripped from list
   * responses — call {@link get} for those.
   */
  list(query, options) {
    return this.client.request("get", "/api/v1/jobs", this.opts(options, { query: this.q(query) }));
  }
  /**
   * Submit a scrape job. Returns `201` immediately with `status: pending`.
   *
   * **Never retried** — there is no idempotency key and a second submission
   * charges a second credit. Use {@link JustCrawl.jobs.submitAndWait} to poll to
   * completion.
   */
  submit(body, options) {
    return this.client.request("post", "/api/v1/jobs", this.opts(options, { body }));
  }
  /** Status for many job ids in one call — cheaper than N polls. */
  batchStatus(body, options) {
    return this.client.request("post", "/api/v1/jobs/batch-status", this.opts(options, { body }));
  }
  /** Aggregate counters over a rolling window. */
  stats(query, options) {
    return this.client.request("get", "/api/v1/jobs/stats", this.opts(options, { query: this.q(query) }));
  }
  /** One job, including the heavy trace fields the list endpoint strips. */
  get(id, options) {
    return this.client.request("get", "/api/v1/jobs/{id}", this.opts(options, { path: { id } }));
  }
  /**
   * The job's result pointer.
   *
   * Returns exactly one of `resultUrl` (presigned, ~15min TTL) or `blobKey`, and
   * `410 Gone` once the org's retention window has passed. `polling.ts` wraps
   * this into typed outcomes — prefer `jobs.fetchResult()` unless you want the
   * raw pointer.
   */
  getResultPointer(id, options) {
    return this.client.request("get", "/api/v1/jobs/{id}/result", this.opts(options, { path: { id } }));
  }
  /**
   * Submit a job and poll until it reaches `completed` or `failed`.
   *
   * Polling in chunks, never streaming — the API has no long-poll surface.
   * Honors `signal` and `maxWaitMs`; the submit itself is a POST and so is never
   * retried, even if the first attempt times out.
   *
   * Note this resolves on `failed` too — a job that failed is a *result*, not an
   * exception. Check `job.status` rather than assuming success.
   *
   * @throws {JobWaitTimeoutError} when the job is still running at `maxWaitMs`.
   */
  async submitAndWait(body, options = {}) {
    const submitted = await this.submit(body, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      headers: options.headers
    });
    const { jobId } = submitted;
    if (typeof jobId !== "string") {
      throw new JustCrawlError({
        message: "Job submission succeeded but the response carried no job id",
        status: 0,
        code: "internal_error",
        inferredCode: true,
        shape: "transport",
        raw: submitted
      });
    }
    return waitForJob(this.client, jobId, options);
  }
  /**
   * Fetch a finished job's body, resolving the presigned URL when there is one.
   *
   * Returns a discriminated outcome rather than a bare string: platform storage
   * yields `kind: 'url'` with the body, custom S3 yields `kind: 'blob'` with the
   * key for you to fetch with your own credentials, and an aged-out result yields
   * `kind: 'expired'` instead of throwing.
   *
   * **Your API key is never sent to the storage host** — the presigned URL is
   * fetched header-free.
   */
  fetchResult(id, options) {
    return fetchJobResult(this.client, id, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      headers: options?.headers
    });
  }
};

// src/resources/plans.ts
var PlansResource = class extends Resource {
  /**
   * Current plan and remaining credits.
   *
   * Worth calling before a large batch: the same numbers drive the `402`
   * quota gate, and a pre-flight check turns a mid-batch failure into a decision.
   */
  status(options) {
    return this.client.request("get", "/api/v1/plans/status", options);
  }
  /** Credit ledger, newest first. */
  transactions(query, options) {
    return this.client.request(
      "get",
      "/api/v1/plans/transactions",
      this.opts(options, { query: this.q(query) })
    );
  }
  /** Whether a recharge request is already pending. */
  rechargeRequestStatus(options) {
    return this.client.request("get", "/api/v1/plans/recharge-request/status", options);
  }
  /** Ask an administrator for more credits. Does not itself add any. */
  requestRecharge(body, options) {
    return this.client.request("post", "/api/v1/plans/recharge-request", this.opts(options, { body }));
  }
};

// src/resources/schedules.ts
var SchedulesResource = class extends Resource {
  list(query, options) {
    return this.client.request("get", "/api/v1/schedules", this.opts(options, { query: this.q(query) }));
  }
  /** Create a schedule. Over-quota orgs get 402 with the standard quota payload. */
  create(body, options) {
    return this.client.request("post", "/api/v1/schedules", this.opts(options, { body }));
  }
  /** Past runs across schedules — the audit trail for "did my crawl fire?". */
  listRuns(query, options) {
    return this.client.request("get", "/api/v1/schedules/runs", this.opts(options, { query: this.q(query) }));
  }
  get(id, options) {
    return this.client.request("get", "/api/v1/schedules/{id}", this.opts(options, { path: { id } }));
  }
  update(id, body, options) {
    return this.client.request("put", "/api/v1/schedules/{id}", this.opts(options, { body, path: { id } }));
  }
  delete(id, options) {
    return this.client.request("delete", "/api/v1/schedules/{id}", this.opts(options, { path: { id } }));
  }
  /** Pause or resume without losing the schedule's configuration or history. */
  toggle(id, body, options) {
    return this.client.request(
      "patch",
      "/api/v1/schedules/{id}/toggle",
      this.opts(options, { body, path: { id } })
    );
  }
  /** Run a schedule immediately, out of band. Consumes quota like any other run. */
  trigger(id, options) {
    return this.client.request(
      "post",
      "/api/v1/schedules/{id}/trigger",
      this.opts(options, { path: { id } })
    );
  }
};

// src/resources/smart-workflows.ts
var SmartWorkflowsResource = class extends Resource {
  /** Smart state for one workflow: current mode plus optimization telemetry. */
  get(workflowId, options) {
    return this.client.request(
      "get",
      "/api/v1/workflows/{workflowId}/smart",
      this.opts(options, { path: { workflowId } })
    );
  }
  /** Switch the workflow between manual and auto-optimizing routing. */
  setMode(workflowId, body, options) {
    return this.client.request(
      "put",
      "/api/v1/workflows/{workflowId}/smart/mode",
      this.opts(options, { body, path: { workflowId } })
    );
  }
  /** Pending routing suggestions for one workflow. */
  /**
   * Every suggestion for one workflow, of every status, newest first.
   *
   * Returns `[]` rather than 404 when the workflow has no suggestions — and,
   * because the endpoint does not verify the id exists, also for an id that
   * matches nothing. An empty result is not evidence the id was right.
   */
  listSuggestions(workflowId, options) {
    return this.client.request(
      "get",
      "/api/v1/workflows/{workflowId}/smart/suggestions",
      this.opts(options, { path: { workflowId } })
    );
  }
  /** Apply a suggestion — this edits the workflow's routing. */
  applySuggestion(workflowId, suggestionId, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/{workflowId}/smart/suggestions/{id}/apply",
      this.opts(options, { path: { workflowId, id: suggestionId } })
    );
  }
  dismissSuggestion(workflowId, suggestionId, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/{workflowId}/smart/suggestions/{id}/dismiss",
      this.opts(options, { path: { workflowId, id: suggestionId } })
    );
  }
  /**
   * Suggestions across every workflow in the org.
   *
   * Lives on this group rather than `workflows` because the payload is the smart
   * suggestion shape, even though its path (`/api/v1/suggestions`) is not nested
   * under a workflow.
   */
  listAllSuggestions(options) {
    return this.client.request("get", "/api/v1/suggestions", options);
  }
};

// src/resources/urls.ts
var UrlsResource = class extends Resource {
  /** Paginated, filterable list of URL items. `pageSize` caps at 100. */
  list(query, options) {
    return this.client.request("get", "/api/v1/urls", this.opts(options, { query: this.q(query) }));
  }
  create(body, options) {
    return this.client.request("post", "/api/v1/urls", this.opts(options, { body }));
  }
  /** Create many URL items in one request — far cheaper than N calls. */
  createBatch(body, options) {
    return this.client.request("post", "/api/v1/urls/batch", this.opts(options, { body }));
  }
  /**
   * Delete many URL items in one request.
   *
   * Note this is a `DELETE` **with a body** — unusual, but it is what the API
   * defines, and the transport sends it. Like every write, it is never retried.
   */
  deleteBatch(body, options) {
    return this.client.request("delete", "/api/v1/urls/batch", this.opts(options, { body }));
  }
  get(id, options) {
    return this.client.request("get", "/api/v1/urls/{id}", this.opts(options, { path: { id } }));
  }
  update(id, body, options) {
    return this.client.request("patch", "/api/v1/urls/{id}", this.opts(options, { body, path: { id } }));
  }
  delete(id, options) {
    return this.client.request("delete", "/api/v1/urls/{id}", this.opts(options, { path: { id } }));
  }
  /** Enable or disable a URL item without deleting it. */
  toggle(id, body, options) {
    return this.client.request(
      "patch",
      "/api/v1/urls/{id}/toggle",
      this.opts(options, { body, path: { id } })
    );
  }
  /** Jobs run against this URL item. */
  listJobs(id, query, options) {
    return this.client.request(
      "get",
      "/api/v1/urls/{id}/jobs",
      this.opts(options, { query: this.q(query), path: { id } })
    );
  }
  /** Extraction results for this URL item, newest first. */
  listExtractions(id, query, options) {
    return this.client.request(
      "get",
      "/api/v1/urls/{id}/extractions",
      this.opts(options, { query: this.q(query), path: { id } })
    );
  }
};

// src/resources/webhooks.ts
var WebhooksResource = class extends Resource {
  /**
   * Push URLs into the org's ingestion pipeline.
   *
   * Subject to a daily URL cap, which answers `429` with a flat message body —
   * and, today, **no `Retry-After` header**. A retry is safe here only in the
   * sense that ingestion dedupes; the SDK still does not retry it, because it is
   * a POST.
   */
  ingest(token, body, options) {
    return this.client.request(
      "post",
      "/api/v1/webhooks/{token}/ingest",
      this.opts(options, { body, path: { token } })
    );
  }
};

// src/resources/workflows.ts
var WorkflowsResource = class extends Resource {
  /**
   * List workflows, optionally filtered by status or domain.
   *
   * Each item carries both `id` and `workflowId` — pass `workflowId` to every
   * other method on this class. See the class doc above.
   */
  list(query, options) {
    return this.client.request("get", "/api/v1/workflows", this.opts(options, { query: this.q(query) }));
  }
  /** Create a workflow. It starts unpublished — {@link publish} makes it routable. */
  create(body, options) {
    return this.client.request("post", "/api/v1/workflows", this.opts(options, { body }));
  }
  /** Create a pre-wired smart workflow rather than assembling the DAG by hand. */
  createDefaultSmart(body, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/create-default-smart",
      this.opts(options, { body })
    );
  }
  /**
   * One workflow, latest version, with its DAG.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  get(id, options) {
    return this.client.request("get", "/api/v1/workflows/{id}", this.opts(options, { path: { id } }));
  }
  update(id, body, options) {
    return this.client.request("put", "/api/v1/workflows/{id}", this.opts(options, { body, path: { id } }));
  }
  /** Delete a workflow. Resolves to `undefined` — the API answers 204. */
  /**
   * Soft-delete a workflow.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  delete(id, options) {
    return this.client.request("delete", "/api/v1/workflows/{id}", this.opts(options, { path: { id } }));
  }
  /**
   * Clone a workflow as a new non-smart draft.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  clone(id, options) {
    return this.client.request("post", "/api/v1/workflows/{id}/clone", this.opts(options, { path: { id } }));
  }
  /**
   * Check the DAG against the 17 publish-time legality rules without publishing.
   *
   * Worth calling before {@link publish} in any automated pipeline: publish
   * enforces the same rules, but failing here costs nothing and names the rule.
   */
  validate(id, body, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/{id}/validate",
      this.opts(options, { body, path: { id } })
    );
  }
  /**
   * Make a workflow live. **Set its route first** — this is the one ordering
   * mistake the API cannot forgive.
   *
   * `create()` hands back a workflow already routed to `'*'`, the org-wide
   * default, and only one PUBLISHED workflow per org may hold a given route. So
   * the naive sequence works exactly once per org and then starts failing:
   *
   * ```ts
   * const wf = await jc.workflows.create({ name, dag });
   * await jc.workflows.publish(wf.workflowId);   // 409 from the 2nd workflow on
   * ```
   *
   * Give each workflow its own route before publishing:
   *
   * ```ts
   * await jc.workflows.setRouting(wf.workflowId, { route: 'domain:example.com' });
   * await jc.workflows.publish(wf.workflowId);
   * ```
   *
   * Throws `JustCrawlError` with `status: 409` when another published workflow
   * already holds the route, and `status: 400` when the DAG fails validation.
   */
  publish(id, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/{id}/publish",
      this.opts(options, { path: { id } })
    );
  }
  unpublish(id, options) {
    return this.client.request(
      "post",
      "/api/v1/workflows/{id}/unpublish",
      this.opts(options, { path: { id } })
    );
  }
  /** Replace the domain→workflow routing table for this workflow. */
  setRouting(id, body, options) {
    return this.client.request(
      "put",
      "/api/v1/workflows/{id}/routing",
      this.opts(options, { body, path: { id } })
    );
  }
  /**
   * Fetch one historical version — jobs pin the version they ran against.
   *
   * `version` is the spec's `number`, not the `number | string` this accepted
   * until the typed `request()` rejected the widening. The looser type promised
   * a call the API does not serve.
   */
  getVersion(id, version, options) {
    return this.client.request(
      "get",
      "/api/v1/workflows/{id}/versions/{version}",
      this.opts(options, { path: { id, version } })
    );
  }
};

// src/client.ts
var DEFAULT_BASE_URL = "https://api.justcrawl.io";
var DEFAULT_TIMEOUT_MS = 3e4;
var MASKED_API_KEY = "sr_live_****";
function buildQueryString(query) {
  if (query === void 0) return "";
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null) continue;
    const push = (v) => {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    };
    if (Array.isArray(value)) {
      for (const item of value) push(item);
    } else if (value instanceof Date) {
      push(value.toISOString());
    } else {
      push(value);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
function encodePathParam(value) {
  return encodeURIComponent(String(value));
}
function interpolatePath(template, params) {
  return template.replace(/\{([^{}]+)\}/g, (_match, name) => {
    const value = params?.[name];
    if (value === void 0 || value === null || String(value).trim() === "") {
      throw new JustCrawlError({
        message: `Path "${template}" needs a value for {${name}}`,
        status: 0,
        code: "invalid_input",
        inferredCode: true,
        shape: "transport"
      });
    }
    return encodePathParam(value);
  });
}
function joinUrl(baseUrl, path) {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
var JustCrawl = class {
  baseUrl;
  timeoutMs;
  retryPolicy;
  /** One group per spec tag. See each group's module for what it covers. */
  jobs;
  workflows;
  smartWorkflows;
  urls;
  schedules;
  extraction;
  analytics;
  benchmarks;
  plans;
  integrations;
  webhooks;
  bi;
  /** Non-enumerable, assigned in the constructor. Never serialize this. */
  apiKey;
  fetchImpl;
  constructor(options) {
    if (typeof options?.apiKey !== "string" || options.apiKey.length === 0) {
      throw new JustCrawlError({
        message: "apiKey is required \u2014 create one under Settings \u2192 API Keys",
        status: 0,
        code: "auth_missing",
        inferredCode: true,
        shape: "transport"
      });
    }
    Object.defineProperty(this, "apiKey", {
      value: options.apiKey,
      enumerable: false,
      writable: false,
      configurable: false
    });
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries
    };
    const injected = options.fetch;
    if (injected === void 0 && typeof globalThis.fetch !== "function") {
      throw new JustCrawlError({
        message: "No global fetch available \u2014 @justcrawl/sdk needs Node 20+, or pass your own `fetch`",
        status: 0,
        code: "internal_error",
        inferredCode: true,
        shape: "transport"
      });
    }
    this.fetchImpl = injected ?? ((input, init) => globalThis.fetch(input, init));
    this.jobs = new JobsResource(this);
    this.workflows = new WorkflowsResource(this);
    this.smartWorkflows = new SmartWorkflowsResource(this);
    this.urls = new UrlsResource(this);
    this.schedules = new SchedulesResource(this);
    this.extraction = new ExtractionResource(this);
    this.analytics = new AnalyticsResource(this);
    this.benchmarks = new BenchmarksResource(this);
    this.plans = new PlansResource(this);
    this.integrations = new IntegrationsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.bi = new BiResource(this);
  }
  /** Masked view for `JSON.stringify`. */
  toJSON() {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      apiKey: MASKED_API_KEY
    };
  }
  /**
   * Masked view for `console.log` / `util.inspect`.
   *
   * Keyed by `Symbol.for('nodejs.util.inspect.custom')` rather than importing
   * `node:util` — same symbol, but it keeps the bundle free of a Node builtin
   * import, which matters for a zero-dependency artifact that bundlers process.
   */
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `JustCrawl { baseUrl: '${this.baseUrl}', apiKey: '${MASKED_API_KEY}' }`;
  }
  /**
   * Issue one API request against a **documented** path — fully typed from the
   * spec. An unknown path, a method the path does not define, or a missing path
   * parameter is a compile error, and the return type is that operation's own
   * success body.
   *
   * Paths are the spec's own templates, with values passed separately. That is
   * the whole mechanism: `'/api/v1/jobs/{id}'` is a member of the `ApiPath`
   * union and so is checked against the spec, whereas an interpolated
   * `` `/api/v1/jobs/${id}` `` is just `string` and is checked against nothing.
   *
   * ```ts
   * const account = await jc.request('get', '/api/v1/account');
   * const job = await jc.request('get', '/api/v1/jobs/{id}', { path: { id } });
   * ```
   *
   * For an endpoint this SDK version does not document, use
   * {@link JustCrawl.requestUnchecked} — deliberately a separate method, because
   * as a second overload of this one it silently accepted every typo'd path
   * (see `src/__tests__/paths.test.ts` for the sweep that now guards this).
   */
  request(method, path, ...args) {
    return this.send(method, path, args[0] ?? {});
  }
  /**
   * Issue one API request against any path, documented or not — **unchecked**.
   *
   * The escape hatch, and deliberately an opt-in one. A preview endpoint, or one
   * published after this SDK version was cut, still works; you supply the
   * response type and accept that nothing validates the path.
   *
   * This used to be a second overload of {@link JustCrawl.request}. It could not
   * stay one: an overload accepting `string` matches everything the
   * literal-union overload would have rejected, so `request('get',
   * '/api/v1/jobsss')` and `request('delete', '/api/v1/jobs/{id}')` both compiled
   * clean. The type safety was advertised in the docs and absent in fact. Naming
   * the unsafe form is what makes the safe form mean something.
   *
   * ```ts
   * const preview = await jc.requestUnchecked<{ ok: boolean }>('get', '/api/v1/preview/thing');
   * ```
   */
  requestUnchecked(method, path, options = {}) {
    return this.send(method, path, options);
  }
  /**
   * The single implementation behind both public forms — every resource wrapper
   * and every escape-hatch call funnels through here, so auth, retries,
   * timeouts, and error mapping have exactly one home (R6).
   *
   * @returns The parsed JSON body, or `undefined` for a 204 / empty 2xx.
   * @throws {JustCrawlError} on any non-2xx, timeout, or transport failure.
   */
  async send(method, path, options = {}) {
    const url = joinUrl(this.baseUrl, interpolatePath(path, options.path)) + buildQueryString(options.query);
    const upperMethod = method.toUpperCase();
    const maxAttempts = this.retryPolicy.maxRetries + 1;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await this.dispatch(upperMethod, url, options);
      } catch (err) {
        if (err instanceof JustCrawlAbortError) throw err;
        const transportRetryable = isRetryableTransportError(upperMethod);
        const wrapped = err instanceof JustCrawlTimeoutError ? new JustCrawlTimeoutError(options.timeoutMs ?? this.timeoutMs, void 0, transportRetryable) : new JustCrawlConnectionError(err, transportRetryable);
        if (attempt < maxAttempts && transportRetryable) {
          lastError = wrapped;
          await sleep(computeDelayMs(attempt, void 0, this.retryPolicy), options.signal);
          continue;
        }
        throw wrapped;
      }
      if (response.ok) return this.parseBody(response);
      const requestId = response.headers.get("X-Request-ID") ?? void 0;
      const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
      const responseRetryable = isRetryableResponse(upperMethod, response.status);
      const error = errorFromResponse(
        response.status,
        response.text,
        requestId,
        retryAfterSeconds,
        responseRetryable
      );
      if (attempt < maxAttempts && responseRetryable) {
        lastError = error;
        await sleep(computeDelayMs(attempt, retryAfterSeconds, this.retryPolicy), options.signal);
        continue;
      }
      throw error;
    }
    throw lastError ?? new JustCrawlConnectionError(new Error("retries exhausted"));
  }
  /**
   * One attempt: build headers, arm the timeout, call `fetch`, **and read the
   * body** — all inside the same armed window.
   *
   * Reading the body here rather than in `request()` is the whole point. A
   * `fetch` promise settles when the response HEADERS arrive; the body is still
   * streaming. If the timer were cleared and the caller's abort listener removed
   * at that moment, every body read would run with no timeout and no
   * cancellation — a server that sent headers and then stalled would hang the
   * caller forever, and `timeoutMs` would silently mean "time to first byte"
   * rather than "time to a usable result".
   *
   * It also keeps mid-body failures inside the `catch` below, so a connection
   * reset during the body surfaces as a typed `JustCrawlTimeoutError` /
   * `JustCrawlAbortError` / `JustCrawlConnectionError` like every other
   * transport failure — and, on a GET, is retryable for the same reason.
   */
  async dispatch(method, url, options) {
    const alreadyAborted = options.signal?.aborted;
    if (alreadyAborted === true) throw new JustCrawlAbortError();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: this.buildHeaders(options),
        body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
        signal: controller.signal
      });
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        headers: response.headers,
        text: await response.text()
      };
    } catch (err) {
      if (timedOut) throw new JustCrawlTimeoutError(timeoutMs);
      if (options.signal?.aborted === true) throw new JustCrawlAbortError();
      throw err;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
  /**
   * Compose request headers.
   *
   * The SDK's own headers are applied **last**, so a caller-supplied header can
   * never displace them — silently swapping the key would send the request
   * unauthenticated, or worse, with someone else's credential.
   *
   * "Applied last" is necessary but NOT sufficient, which is the subtle part.
   * HTTP header names are case-insensitive but **object keys are not**: a caller
   * passing `authorization` (lowercase) survives the spread as a second, distinct
   * key alongside our `Authorization`, and `fetch`'s `Headers` constructor then
   * COMBINES same-named values rather than letting the later one win:
   *
   *   { ...{ authorization: 'X' }, Authorization: 'Bearer k' }
   *     -> outgoing header: `authorization: X, Bearer k`
   *
   * So the caller's value is sent, the key is smuggled alongside it, and the
   * request fails authentication in a way that reads like a bad key. Reserved
   * names are therefore filtered out of the caller's map by CASE-FOLDED
   * comparison before ours are applied.
   */
  buildHeaders(options) {
    const reserved = /* @__PURE__ */ new Set(["authorization", "accept", "content-type"]);
    const callerHeaders = Object.fromEntries(
      Object.entries(options.headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))
    );
    const headers = {
      ...callerHeaders,
      // Opts into the structured `JustcrawlError` contract wherever the gateway
      // honors it — the middleware switches on this exact media type.
      Accept: JUSTCRAWL_MEDIA_TYPE
    };
    if (options.body !== void 0) headers["Content-Type"] = "application/json";
    headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
  /**
   * Read a successful response body.
   *
   * A 204 or any zero-length 2xx resolves to `undefined` rather than throwing a
   * JSON parse error — five wrapped DELETE endpoints return 204.
   */
  parseBody(response) {
    if (response.status === 204) return void 0;
    const text = response.text;
    if (text.length === 0) return void 0;
    try {
      return JSON.parse(text);
    } catch {
      throw new JustCrawlError({
        message: `Expected JSON from ${response.url || "the API"} but got a non-JSON ${response.status} response`,
        status: response.status,
        code: "internal_error",
        inferredCode: true,
        shape: "non-json",
        requestId: response.headers.get("X-Request-ID") ?? void 0,
        raw: text.slice(0, 500)
      });
    }
  }
};
export {
  AnalyticsResource,
  BenchmarksResource,
  BiResource,
  DEFAULT_BASE_URL,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUT_MS,
  ExtractionResource,
  IntegrationsResource,
  JobWaitTimeoutError,
  JobsResource,
  JustCrawl,
  JustCrawlAbortError,
  JustCrawlConnectionError,
  JustCrawlError,
  JustCrawlTimeoutError,
  MASKED_API_KEY,
  NON_TERMINAL_JOB_STATUSES,
  PlansResource,
  SchedulesResource,
  SmartWorkflowsResource,
  TERMINAL_JOB_STATUSES,
  UrlsResource,
  WebhooksResource,
  WorkflowsResource,
  fetchJobResult,
  inferCodeFromStatus,
  isIndexingPending,
  isRetryableResponse,
  isRetryableTransportError,
  isTerminalStatus,
  parseRetryAfter,
  waitForExtractionResult,
  waitForJob
};
