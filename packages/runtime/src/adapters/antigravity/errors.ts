import {
  RuntimeExecutionError,
  type RuntimeExecutionErrorMetadata,
  classifyByHttpStatus,
  classifyByMessageFallback,
  type RuntimeErrorCategory,
} from "../../errors.js";

/** Antigravity CLI error string patterns that map to specific categories. */
const CLI_NOT_FOUND_PATTERNS = ["enoent", "not recognized", "no such file", "cannot find"];
const CAPACITY_PATTERNS = ["503", "no capacity", "overloaded", "capacity"];
const QUOTA_PATTERNS = ["resourceexhausted", "quota", "rate limit", "429"];
const AUTH_PATTERNS = [
  "not logged in",
  "authentication",
  "unauthenticated",
  "login required",
  "unauthorized",
];

/** Map semantic category to Antigravity-specific adapter code. */
const CATEGORY_TO_ADAPTER_CODE: Record<RuntimeErrorCategory, string> = {
  rate_limit: "ANTIGRAVITY_RATE_LIMIT",
  auth: "ANTIGRAVITY_AUTH_ERROR",
  timeout: "ANTIGRAVITY_TIMEOUT",
  permission: "ANTIGRAVITY_PERMISSION_DENIED",
  stream: "ANTIGRAVITY_STREAM_ERROR",
  transport: "ANTIGRAVITY_TRANSPORT_ERROR",
  model_not_found: "ANTIGRAVITY_MODEL_NOT_FOUND",
  context_length: "ANTIGRAVITY_CONTEXT_LENGTH",
  content_filter: "ANTIGRAVITY_CONTENT_FILTER",
  unknown: "ANTIGRAVITY_RUNTIME_ERROR",
};

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classify(
  message: string,
  httpStatus?: number,
): { adapterCode: string; category: RuntimeErrorCategory } {
  if (httpStatus !== undefined) {
    const category = classifyByHttpStatus(httpStatus);
    if (category) {
      return { adapterCode: CATEGORY_TO_ADAPTER_CODE[category], category };
    }
  }

  const lowered = message.toLowerCase();

  if (CLI_NOT_FOUND_PATTERNS.some((p) => lowered.includes(p))) {
    return { adapterCode: "ANTIGRAVITY_CLI_NOT_FOUND", category: "transport" };
  }

  if (CAPACITY_PATTERNS.some((p) => lowered.includes(p))) {
    return { adapterCode: "ANTIGRAVITY_CAPACITY_UNAVAILABLE", category: "rate_limit" };
  }

  if (QUOTA_PATTERNS.some((p) => lowered.includes(p))) {
    return { adapterCode: "ANTIGRAVITY_RATE_LIMIT", category: "rate_limit" };
  }

  if (AUTH_PATTERNS.some((p) => lowered.includes(p))) {
    return { adapterCode: "ANTIGRAVITY_AUTH_ERROR", category: "auth" };
  }

  const category = classifyByMessageFallback(message);
  return { adapterCode: CATEGORY_TO_ADAPTER_CODE[category], category };
}

function mergeMetadata(
  error: unknown,
  httpStatus?: number,
  metadata: RuntimeExecutionErrorMetadata = {},
): RuntimeExecutionErrorMetadata {
  const baseMetadata: RuntimeExecutionErrorMetadata =
    error instanceof RuntimeExecutionError
      ? {
          httpStatus: error.httpStatus,
          resetAt: error.resetAt,
          retryAfterMs: error.retryAfterMs,
          retryAfterSeconds: error.retryAfterSeconds,
          limitSnapshot: error.limitSnapshot,
          providerMeta: error.providerMeta,
        }
      : {};

  return {
    ...baseMetadata,
    ...metadata,
    httpStatus: httpStatus ?? metadata.httpStatus ?? baseMetadata.httpStatus,
  };
}

export class AntigravityRuntimeAdapterError extends RuntimeExecutionError {
  public readonly adapterCode: string;

  constructor(
    message: string,
    adapterCode: string,
    category: RuntimeErrorCategory,
    cause?: unknown,
    metadata: RuntimeExecutionErrorMetadata = {},
  ) {
    super(message, cause, category, { ...metadata, adapterCode });
    this.name = "AntigravityRuntimeAdapterError";
    this.adapterCode = adapterCode;
  }
}

export function classifyAntigravityRuntimeError(
  error: unknown,
  httpStatus?: number,
  metadata: RuntimeExecutionErrorMetadata = {},
): AntigravityRuntimeAdapterError {
  if (error instanceof AntigravityRuntimeAdapterError) {
    return error;
  }

  const message = messageFromUnknown(error);
  const { adapterCode, category } = classify(message, httpStatus);
  const merged = mergeMetadata(error, httpStatus, metadata);

  return new AntigravityRuntimeAdapterError(
    message,
    adapterCode,
    category,
    error instanceof Error ? error : undefined,
    merged,
  );
}
