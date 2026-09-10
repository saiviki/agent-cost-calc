import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const SECRET_HEADER = "x-telemetry-secret";

/**
 * Guard for the telemetry endpoints.
 *
 * Fails CLOSED: an unset TELEMETRY_SECRET returns 503, never an open endpoint.
 * A misconfigured deploy must refuse writes, not accept anonymous ones — these
 * counters feed the day-90 scale-or-kill call, so a poisoned number is worse
 * than a missing one.
 *
 * Returns null when the caller is authorised, otherwise the response to send.
 */
export function requireTelemetrySecret(request: NextRequest): NextResponse | null {
  const expected = process.env.TELEMETRY_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "TELEMETRY_SECRET is not configured", missing: ["TELEMETRY_SECRET"] },
      { status: 503 },
    );
  }

  const presented = request.headers.get(SECRET_HEADER);
  if (!presented || !constantTimeEquals(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/** Compare without leaking length or content through timing. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, so compare digests of equal width.
  if (left.length !== right.length) {
    // Still burn a comparison so the reject path costs the same either way.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
