import { NextResponse } from "next/server";
import { getTelemetryStore, StoreConfigError } from "./store";

export function storeErrorResponse(error: unknown): NextResponse {
  if (error instanceof StoreConfigError) {
    return NextResponse.json(
      { error: error.message, missing: error.missing },
      { status: 500 },
    );
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function withTelemetryStore<T>(
  handler: (store: ReturnType<typeof getTelemetryStore>) => Promise<T>,
): Promise<T | NextResponse> {
  try {
    const store = getTelemetryStore();
    return await handler(store);
  } catch (error) {
    return storeErrorResponse(error);
  }
}
