import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Neon's pooled endpoint reports an empty `search_path` and rejects it as a
// startup parameter, so unqualified table names ("stocks") fail to resolve —
// and Drizzle emits unqualified names throughout. Setting search_path at the
// database or role level does not propagate through the pooler either, so we
// prefer the direct endpoint when the Neon integration provides one. Elsewhere
// (local Postgres, any other host) DATABASE_URL is used unchanged.
const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse the client across hot reloads in dev.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.pgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export { schema };
