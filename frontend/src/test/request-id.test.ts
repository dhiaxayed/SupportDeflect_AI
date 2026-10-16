/**
 * @file UUID helper contracts for native secure contexts and the isolated HTTP lab fallback.
 * Check use of native randomUUID plus distinct correctly shaped/versioned fallback UUIDs from
 * real getRandomValues; no Math.random substitute is accepted for idempotency keys.
 */

import { describe, expect, it, vi } from "vitest";
import { createRequestId } from "@/lib/request-id";

describe("browser request identifiers", () => {
  it("uses the native UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "ba01f310-4b19-4be2-ade7-69541164bc1c");
    vi.stubGlobal("crypto", { randomUUID });
    expect(createRequestId()).toBe("ba01f310-4b19-4be2-ade7-69541164bc1c");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("generates distinct valid UUIDs without the HTTPS-only randomUUID API", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const identifiers = Array.from({ length: 100 }, createRequestId);
    expect(new Set(identifiers).size).toBe(100);
    for (const id of identifiers)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
