import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireTelemetrySecret, SECRET_HEADER } from "../auth";

const SECRET = "s3cr3t-value-for-tests";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.test/api/telemetry/increment", { headers });
}

describe("requireTelemetrySecret", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.TELEMETRY_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TELEMETRY_SECRET;
    else process.env.TELEMETRY_SECRET = original;
  });

  it("fails CLOSED with 503 when TELEMETRY_SECRET is unset", async () => {
    delete process.env.TELEMETRY_SECRET;
    const res = requireTelemetrySecret(req({ [SECRET_HEADER]: "anything" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    // An unconfigured deploy must never behave like an open endpoint.
    expect(res!.status).not.toBe(200);
  });

  it("rejects a request with no secret header", async () => {
    process.env.TELEMETRY_SECRET = SECRET;
    const res = requireTelemetrySecret(req());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a wrong secret of the same length", async () => {
    process.env.TELEMETRY_SECRET = SECRET;
    const wrong = "x".repeat(SECRET.length);
    const res = requireTelemetrySecret(req({ [SECRET_HEADER]: wrong }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a wrong secret of a different length without throwing", async () => {
    process.env.TELEMETRY_SECRET = SECRET;
    const res = requireTelemetrySecret(req({ [SECRET_HEADER]: "short" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("admits the correct secret", async () => {
    process.env.TELEMETRY_SECRET = SECRET;
    expect(requireTelemetrySecret(req({ [SECRET_HEADER]: SECRET }))).toBeNull();
  });

  it("does not leak the expected secret in the rejection body", async () => {
    process.env.TELEMETRY_SECRET = SECRET;
    const res = requireTelemetrySecret(req({ [SECRET_HEADER]: "nope" }));
    const body = JSON.stringify(await res!.json());
    expect(body).not.toContain(SECRET);
  });
});
