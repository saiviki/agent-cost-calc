import { Redis } from "@upstash/redis";

/** Required env vars for the durable Redis store (Upstash via Vercel Marketplace). */
export const KV_ENV_VARS = ["KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;

export type KvEnvVar = (typeof KV_ENV_VARS)[number];

export class StoreConfigError extends Error {
  readonly missing: KvEnvVar[];

  constructor(missing: KvEnvVar[]) {
    super(`Missing required environment variable(s): ${missing.join(", ")}`);
    this.name = "StoreConfigError";
    this.missing = missing;
  }
}

export interface TelemetryRecord {
  ts: number;
  data: Record<string, unknown>;
}

export interface TelemetryStore {
  increment(bucket: string, key: string): Promise<number>;
  get(bucket: string, key: string): Promise<number>;
  append(collection: string, record: Record<string, unknown>): Promise<void>;
  list(collection: string, sinceTs: number): Promise<TelemetryRecord[]>;
}

function counterKey(bucket: string, key: string): string {
  return `counter:${bucket}:${key}`;
}

function collectionKey(collection: string): string {
  return `collection:${collection}`;
}

export function missingKvEnvVars(): KvEnvVar[] {
  return KV_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

export function assertKvEnvConfigured(): void {
  const missing = missingKvEnvVars();
  if (missing.length > 0) {
    throw new StoreConfigError(missing);
  }
}

export function createMemoryStore(): TelemetryStore {
  const counters = new Map<string, number>();
  const collections = new Map<string, TelemetryRecord[]>();

  return {
    async increment(bucket, key) {
      const id = counterKey(bucket, key);
      const next = (counters.get(id) ?? 0) + 1;
      counters.set(id, next);
      return next;
    },

    async get(bucket, key) {
      return counters.get(counterKey(bucket, key)) ?? 0;
    },

    async append(collection, record) {
      const id = collectionKey(collection);
      const entries = collections.get(id) ?? [];
      entries.push({ ts: Date.now(), data: record });
      collections.set(id, entries);
    },

    async list(collection, sinceTs) {
      const entries = collections.get(collectionKey(collection)) ?? [];
      return entries.filter((entry) => entry.ts >= sinceTs);
    },
  };
}

export function createRedisStore(redis: Redis = Redis.fromEnv()): TelemetryStore {
  return {
    async increment(bucket, key) {
      return redis.incr(counterKey(bucket, key));
    },

    async get(bucket, key) {
      const value = await redis.get<number>(counterKey(bucket, key));
      return value ?? 0;
    },

    async append(collection, record) {
      const ts = Date.now();
      const member = JSON.stringify({ ts, data: record });
      await redis.zadd(collectionKey(collection), { score: ts, member });
    },

    async list(collection, sinceTs) {
      const members = await redis.zrange<(TelemetryRecord | string)[]>(
        collectionKey(collection),
        sinceTs,
        "+inf",
        { byScore: true },
      );
      return members.map((member) =>
        typeof member === "string"
          ? (JSON.parse(member) as TelemetryRecord)
          : member,
      );
    },
  };
}

/** Returns the durable store or throws StoreConfigError when env vars are unset. */
export function getTelemetryStore(): TelemetryStore {
  assertKvEnvConfigured();
  return createRedisStore();
}
