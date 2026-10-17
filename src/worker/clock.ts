/** The current time in unix seconds, read through Effect's Clock so tests can control it. */
import { Clock, Effect } from "effect";

export const nowSeconds: Effect.Effect<number> = Effect.map(Clock.currentTimeMillis, (ms) =>
  Math.floor(ms / 1000),
);
