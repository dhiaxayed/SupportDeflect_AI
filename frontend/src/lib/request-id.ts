/**
 * @file Browser UUID generation for payment, refund and campaign idempotency keys. Callers
 * retain one value for an operation/retry rather than regenerating it on every submission. The
 * fallback supports the documented isolated HTTP VM while preserving cryptographic randomness.
 */

/**
 * Create a version-4 UUID using native randomUUID when available, otherwise getRandomValues
 * with UUID version/variant bits. This avoids HTTP-context crashes without weakening key
 * uniqueness.
 */
export function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // randomUUID requires a secure context; getRandomValues also works on an isolated HTTP VM.
  // Preserve cryptographic randomness and UUID version/variant bits for financial deduplication.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
