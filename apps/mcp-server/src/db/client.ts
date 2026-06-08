import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDbClient(env: CloudflareBindings) {
  const connectionString = `postgresql://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`;
  const client = postgres(connectionString, { ssl: false, max: 1 });
  return drizzle(client, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

// The transaction handle passed to `db.transaction(async (tx) => …)`. Helpers
// that must run either standalone or inside a transaction accept `DbOrTx` so
// the same code path is reusable (e.g. chargeWallet inside the product-create
// transaction so insert + charge commit or roll back together).
export type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbOrTx = DbClient | DbTx;
