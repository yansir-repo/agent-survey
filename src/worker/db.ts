/**
 * D1, as an Effect service. A failed statement is a defect: the app has no meaningful recovery from a
 * broken database, and the RPC layer reports defects as such.
 */
import { Context, Effect, Layer } from "effect";

export type Row = Readonly<Record<string, unknown>>;
export type D1Like = Pick<D1Database, "prepare" | "batch">;

export class Db extends Context.Service<
  Db,
  {
    readonly all: (
      sql: string,
      params?: ReadonlyArray<unknown>,
    ) => Effect.Effect<ReadonlyArray<Row>>;
    readonly first: (
      sql: string,
      params?: ReadonlyArray<unknown>,
    ) => Effect.Effect<Row | undefined>;
    readonly run: (sql: string, params?: ReadonlyArray<unknown>) => Effect.Effect<number>;
  }
>()("agent-survey/Db") {}

export const DbLive = (d1: D1Like): Layer.Layer<Db> =>
  Layer.succeed(Db, {
    all: (sql, params = []) =>
      Effect.promise(() =>
        d1
          .prepare(sql)
          .bind(...params)
          .all<Row>(),
      ).pipe(
        Effect.map((r) => r.results),
        Effect.withSpan("db.all"),
      ),
    first: (sql, params = []) =>
      Effect.promise(() =>
        d1
          .prepare(sql)
          .bind(...params)
          .first<Row>(),
      ).pipe(
        Effect.map((r) => r ?? undefined),
        Effect.withSpan("db.first"),
      ),
    run: (sql, params = []) =>
      Effect.promise(() =>
        d1
          .prepare(sql)
          .bind(...params)
          .run(),
      ).pipe(
        Effect.map((r) => r.meta.changes),
        Effect.withSpan("db.run"),
      ),
  });

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
