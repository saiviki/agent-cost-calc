import { NextRequest, NextResponse } from "next/server";
import { withTelemetryStore } from "@/telemetry/api";
import { requireTelemetrySecret } from "@/telemetry/auth";

export async function GET(request: NextRequest) {
  const denied = requireTelemetrySecret(request);
  if (denied) return denied;

  const bucket = request.nextUrl.searchParams.get("bucket");
  const key = request.nextUrl.searchParams.get("key");

  if (!bucket || !key) {
    return NextResponse.json(
      { error: "bucket and key query parameters are required" },
      { status: 400 },
    );
  }

  const result = await withTelemetryStore((store) => store.get(bucket, key));
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
