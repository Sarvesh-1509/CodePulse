/**
 * Platform integration error taxonomy (Modules 3-5).
 *
 * Every adapter throws PlatformError with a machine-readable `kind`.
 * Services map kinds to HTTP statuses + sanitized client messages so no
 * upstream internals, payloads, or stack traces ever reach clients.
 */
export type PlatformErrorKind =
  | "invalid-username"
  | "not-found"
  | "rate-limited"
  | "timeout"
  | "network"
  | "upstream"
  | "unsupported"
  | "invalid-response";

export class PlatformError extends Error {
  readonly kind: PlatformErrorKind;
  /**
   * Optional internal diagnostic fragment (counts, field paths, stage
   * names). Safe by construction: never payloads, URLs, tokens, or HTML.
   * Services forward only `message` to clients; this stays server-side.
   */
  readonly details?: string;

  constructor(kind: PlatformErrorKind, message: string, details?: string) {
    super(message);
    this.kind = kind;
    this.details = details;
  }
}

export function invalidUsername(message: string): PlatformError {
  return new PlatformError("invalid-username", message);
}

export function profileNotFound(message: string, details?: string): PlatformError {
  return new PlatformError("not-found", message, details);
}

export function rateLimited(message: string): PlatformError {
  return new PlatformError("rate-limited", message);
}

export function upstreamTimeout(message: string): PlatformError {
  return new PlatformError("timeout", message);
}

export function networkFailure(message: string): PlatformError {
  return new PlatformError("network", message);
}

export function upstreamFailure(message: string): PlatformError {
  return new PlatformError("upstream", message);
}

export function unsupported(message: string): PlatformError {
  return new PlatformError("unsupported", message);
}

export function invalidResponse(message: string, details?: string): PlatformError {
  return new PlatformError("invalid-response", message, details);
}
