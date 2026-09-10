import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getCounter } from "@/app/api/telemetry/get/route";
import { POST as incrementCounter } from "@/app/api/telemetry/increment/route";
import {
  assertKvEnvConfigured,
  createMemoryStore,
  createRedisStore,
  KV_ENV_VARS,
  missingKvEnvVars,
  StoreConfigError,
  type TelemetryStore,
} from "../store";

const backends: { name: string; create: () => TelemetryStore }[] = [
  { name: "memory", create: createMemoryStore },
];

if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  backends.push({ name: "redis", create: () => createRedisStore() });
}

function runStoreSuite(name: string, createStore: () => TelemetryStore) {
  describe(`TelemetryStore (${name})`, () => {
    let store: TelemetryStore;
    let suffix: string;

    beforeEach(() => {
      store = createStore();
      suffix = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    });

    it("increment returns increasing values and get reads them back", async () => {
      const bucket = `runs-${suffix}`;
      expect(await store.get(bucket, "total")).toBe(0);
      expect(await store.increment(bucket, "total")).toBe(1);
      expect(await store.increment(bucket, "total")).toBe(2);
      expect(await store.get(bucket, "total")).toBe(2);
    });

    it("isolates counters by bucket and key", async () => {
      const bucketA = `a-${suffix}`;
      const bucketB = `b-${suffix}`;
      await store.increment(bucketA, "x");
      await store.increment(bucketB, "x");
      await store.increment(bucketA, "y");
      expect(await store.get(bucketA, "x")).toBe(1);
      expect(await store.get(bucketB, "x")).toBe(1);
      expect(await store.get(bucketA, "y")).toBe(1);
      expect(await store.get(bucketA, "z")).toBe(0);
    });

    it("append and list return records since a timestamp", async () => {
      const collection = `events-${suffix}`;
      const since = Date.now();
      await store.append(collection, { event: "first" });
      await store.append(collection, { event: "second" });
      const records = await store.list(collection, since);
      expect(records.length).toBe(2);
      expect(records[0].data.event).toBe("first");
      expect(records[1].data.event).toBe("second");
      expect(records.every((record) => record.ts >= since)).toBe(true);
    });

    it("list filters out records before sinceTs", async () => {
      const collection = `events-${suffix}`;
      await store.append(collection, { event: "old" });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const cutoff = Date.now();
      await store.append(collection, { event: "new" });
      const records = await store.list(collection, cutoff);
      expect(records).toHaveLength(1);
      expect(records[0].data.event).toBe("new");
    });
  });
}

for (const backend of backends) {
  runStoreSuite(backend.name, backend.create);
}

describe("KV env configuration", () => {
  const saved: Partial<Record<string, string | undefined>> = {};

  beforeEach(() => {
    for (const name of KV_ENV_VARS) {
      saved[name] = process.env[name];
    }
  });

  afterEach(() => {
    for (const name of KV_ENV_VARS) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  });

  it("missingKvEnvVars lists unset KV_REST_API_URL and KV_REST_API_TOKEN", () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    expect(missingKvEnvVars()).toEqual(["KV_REST_API_URL", "KV_REST_API_TOKEN"]);
  });

  it("assertKvEnvConfigured throws StoreConfigError naming missing vars", () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    expect(() => assertKvEnvConfigured()).toThrow(StoreConfigError);
    try {
      assertKvEnvConfigured();
    } catch (error) {
      expect(error).toBeInstanceOf(StoreConfigError);
      expect((error as StoreConfigError).missing).toContain("KV_REST_API_URL");
      expect((error as StoreConfigError).missing).toContain("KV_REST_API_TOKEN");
    }
  });
});

describe("telemetry API routes", () => {
  const saved: Partial<Record<string, string | undefined>> = {};

  const TEST_SECRET = "route-suite-secret";
  const AUTH = { "x-telemetry-secret": TEST_SECRET };
  let savedSecret: string | undefined;

  beforeEach(() => {
    for (const name of KV_ENV_VARS) {
      saved[name] = process.env[name];
    }
    // These tests exercise STORE misconfiguration, not auth. Authenticate so the
    // request reaches the store check; the guard itself is covered in auth.test.ts.
    savedSecret = process.env.TELEMETRY_SECRET;
    process.env.TELEMETRY_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    for (const name of KV_ENV_VARS) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    if (savedSecret === undefined) delete process.env.TELEMETRY_SECRET;
    else process.env.TELEMETRY_SECRET = savedSecret;
    vi.restoreAllMocks();
  });

  it("GET /api/telemetry/get returns 500 naming missing env vars when unset", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const response = await getCounter(
      new NextRequest("http://localhost/api/telemetry/get?bucket=runs&key=total", {
        headers: AUTH,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("KV_REST_API_URL");
    expect(body.error).toContain("KV_REST_API_TOKEN");
    expect(body.value).toBeUndefined();
  });

  it("POST /api/telemetry/increment returns 500 naming missing env vars when unset", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const response = await incrementCounter(
      new NextRequest("http://localhost/api/telemetry/increment", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({ bucket: "runs", key: "total" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("KV_REST_API_URL");
    expect(body.value).toBeUndefined();
  });
});
