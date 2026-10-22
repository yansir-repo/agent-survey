/**
 * D1, through Effect SQL: `@effect/sql-d1` turns the binding into the `SqlClient` the registry
 * queries. A failed statement is a defect: the app has no meaningful recovery from a broken
 * database, and the RPC layer reports defects as such — `statement` makes it one where it is run.
 */
import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";
import type { SqlClient, SqlError } from "effect/sql";

export type Row = Readonly<Record<string, unknown>>;

/** A config-free layer over a concrete binding: its ConfigError channel cannot fire. */
export const DbLive = (d1: D1Database): Layer.Layer<SqlClient.SqlClient> =>
  Layer.orDie(D1Client.layer({ db: d1 }));

export const statement: <A, R>(
  self: Effect.Effect<A, SqlError.SqlError, R>,
) => Effect.Effect<A, never, R> = Effect.orDie;

// ---- reading untyped rows ----------------------------------------------------------------------

export const str = (row: Row, key: string): string => {
  const v = row[key];
  return typeof v === "string" ? v : typeof v === "number" ? v.toString() : "";
};
export const num = (row: Row, key: string): number => {
  const v = row[key];
  return typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0;
};
export const optStr = (row: Row, key: string): string | null => {
  const v = row[key];
  return typeof v === "string" && v !== "" ? v : null;
};
