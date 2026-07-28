// BullMQ queues + Redis connection shared by the API (producer) and worker.
// We pass connection *options* (not an ioredis instance) so BullMQ uses its own
// bundled ioredis — avoids dual-version type clashes.
import { Queue, type ConnectionOptions } from "bullmq";

export const PARSE_QUEUE = "fundflow-parse";
export const SYNC_QUEUE = "fundflow-sync";

export interface ParseJob {
  uploadId: number;
  storedPath: string;
  filename: string;
  fundNameHint?: string;
  amcHint?: string;
}

/**
 * Discovery + download for every enabled AMC. Runs on the worker because it
 * needs headless Chrome and minutes of wall time, neither of which a
 * serverless function can offer.
 */
export interface SyncJob {
  requestedAt: string;
}

function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");
  // Managed Redis (Upstash et al.) authenticates and requires TLS on rediss://.
  const secure = url.protocol === "rediss:";
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    ...(secure ? { tls: { servername: url.hostname } } : {}),
    maxRetriesPerRequest: null,
  };
}

export const connection = redisConnection();

const globalForQueue = globalThis as unknown as {
  parseQueue?: Queue<ParseJob>;
  syncQueue?: Queue<SyncJob>;
};

export const parseQueue: Queue<ParseJob> =
  globalForQueue.parseQueue ?? new Queue<ParseJob>(PARSE_QUEUE, { connection });

export const syncQueue: Queue<SyncJob> =
  globalForQueue.syncQueue ?? new Queue<SyncJob>(SYNC_QUEUE, { connection });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.parseQueue = parseQueue;
  globalForQueue.syncQueue = syncQueue;
}
