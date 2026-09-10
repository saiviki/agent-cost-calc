import { NextRequest, NextResponse } from "next/server";
import { withTelemetryStore } from "@/telemetry/api";
import { requireTelemetrySecret } from "@/telemetry/auth";

export async function POST(request: NextRequest) {
  const denied = requireTelemetrySecret(request);
  if (denied) return denied;

  let body: { bucket?: string; key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { bucket, key } = body;
  if (!bucket || !key) {
    return NextResponse.json(
      { error: "bucket and key are required" },
      { status: 400 },
    );
  }

  const result = await withTelemetryStore((store) => store.increment(bucket, key));
  if (result instanceof NextResponse) {
    return result;
  }

  return NextResponse.json({
    bucket,
    key,
    value: result,
    ts: new Date().toISOString(),
  });
}
