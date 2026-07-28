// BullMQ queue + Redis connection shared by the API (producer) and worker.
// We pass connection *options* (not an ioredis instance) so BullMQ uses its own
// bundled ioredis — avoids dual-version type clashes.
import { Queue, type ConnectionOptions } from "bullmq";

export const PARSE_QUEUE = "fundflow-parse";

export interface ParseJob {
  uploadId: number;
  storedPath: string;
  filename: string;
  fundNameHint?: string;
  amcHint?: string;
}

function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
  };
}

export const connection = redisConnection();

const globalForQueue = globalThis as unknown as {
  parseQueue?: Queue<ParseJob>;
};

export const parseQueue: Queue<ParseJob> =
  globalForQueue.parseQueue ?? new Queue<ParseJob>(PARSE_QUEUE, { connection });
if (process.env.NODE_ENV !== "production") globalForQueue.parseQueue = parseQueue;
