import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function getConnectionUrl(): string {
  // Amplify blocks certain bare env var names; FF_ prefix is the safe alternative.
  // Check FF_ first, fall back to bare name, then fall back to hard-coded defaults.
  const host = process.env.FF_PGHOST ?? process.env.PGHOST ?? "170.9.252.93";
  const port = process.env.FF_PGPORT ?? process.env.PGPORT ?? "5433";
  const db = process.env.FF_PGDATABASE ?? process.env.PGDATABASE ?? "ff_brand_studio";
  const user = process.env.FF_PGUSER ?? process.env.PGUSER ?? "postgres";
  const pass = encodeURIComponent(process.env.FF_PGPASSWORD ?? process.env.PGPASSWORD ?? "");
  return `postgres://${user}:${pass}@${host}:${port}/${db}?sslmode=disable`;
}

let _client: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_client) {
    const sql = postgres(getConnectionUrl(), { max: 5 });
    _client = drizzle(sql, { schema });
  }
  return _client;
}
