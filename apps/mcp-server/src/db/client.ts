import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDbClient(env: CloudflareBindings) {
  const connectionString = `postgresql://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`;
  const client = postgres(connectionString, { ssl: false, max: 1 });
  return drizzle(client, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;
