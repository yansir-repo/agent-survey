/**
 * What the deployed Worker logged, without re-deriving the observability API every time.
 *
 *   node scripts/logs.ts                          # last 15 minutes: every /rpc call, its wall/cpu time
 *   node scripts/logs.ts --since 2h --timing      # only the `grill` phase lines
 *   node scripts/logs.ts --view events --json     # raw log events
 *
 * The two views answer different questions and both were hand-built during the "the board is slow"
 * work:
 *
 * - `invocations` (default) groups events by request: time, colo, wall time, CPU time. CPU ≈ tens of ms
 *   against seconds of wall time means the time went into waiting (a D1 round trip, the archive
 *   binding), not arithmetic.
 * - `events` is the raw log lines, which is where `grill`'s per-phase numbers live
 *   (`db.allBatch` also logs `primary` / `region`, i.e. whether a read hit the replica).
 *
 * Uses `cf` (the operator's own login) rather than a token: logs are an account-level resource, not
 * something the board's Access credential reaches.
 */
import { execFileSync } from "node:child_process";

const ACCOUNT = "d1da6c26f60e13fb006a3d4b5dae3f09";
const SCRIPT = "grill-me";

const USAGE = `用法：node scripts/logs.ts [--since 15m] [--view invocations|events] [--timing] [--json] [--limit N]

  --since   多久以前开始（15m / 2h / 1d，默认 15m）
  --view    invocations（默认：每次请求的时间/colo/墙钟/CPU）或 events（原始日志行）
  --timing  只看 grill 那几行（等价于 --view events 再过滤）
  --json    打印原始响应
  --limit   最多取多少条（默认 100）`;

const seconds = (span: string): number => {
  const match = /^(\d+)([smhd])$/.exec(span.trim());
  if (!match) throw new Error(`--since 要写成 15m / 2h / 1d 这样，收到的是 ${span}`);
  const n = Number(match[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as "s" | "m" | "h" | "d"];
};

const args = { since: "15m", view: "invocations", timing: false, json: false, limit: 100 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] ?? "";
  if (a === "--since") args.since = argv[++i] ?? "15m";
  else if (a === "--view") args.view = argv[++i] ?? "invocations";
  else if (a === "--timing") {
    args.timing = true;
    args.view = "events";
  } else if (a === "--json") args.json = true;
  else if (a === "--limit") args.limit = Number(argv[++i] ?? 100) || 100;
  else if (a === "-h" || a === "--help") {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`不认识的参数：${a}\n\n${USAGE}`);
    process.exit(2);
  }
}

const to = Date.now();
const from = to - seconds(args.since) * 1000;
const body = {
  queryId: "adhoc",
  view: args.view,
  limit: args.limit,
  timeframe: { from, to },
  parameters: {
    datasets: ["cloudflare-workers"],
    // `orderBy` is required by the API whenever parameters are given, even for the event views.
    orderBy: { value: "count" },
    filters: [{ key: "$workers.scriptName", operation: "eq", value: SCRIPT, type: "string" }],
  },
};

const raw = execFileSync(
  "cf",
  [
    "observability",
    "telemetry",
    "query",
    "--query-id",
    "adhoc",
    "--timeframe-from",
    String(from),
    "--timeframe-to",
    String(to),
    "--limit",
    String(args.limit),
    "--body",
    JSON.stringify(body),
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const parsed = JSON.parse(raw) as {
  invocations?: Record<string, unknown[]>;
  /** The event view nests its rows: `{ events: [...], fields, count }`. */
  events?: ReadonlyArray<unknown> | { events?: ReadonlyArray<unknown>; count?: number };
};
const eventRows = (): ReadonlyArray<unknown> => {
  const events = parsed.events;
  if (events === undefined) return [];
  if (Array.isArray(events)) return events as ReadonlyArray<unknown>;
  return (events as { events?: ReadonlyArray<unknown> }).events ?? [];
};
if (args.json) {
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(0);
}

const at = (ts: unknown) => new Date(Number(ts)).toISOString().slice(11, 19);
const messagesOf = (events: ReadonlyArray<unknown>): string[] =>
  events
    .map((e) => String(((e as { source?: { message?: unknown } }).source?.message ?? "") as string))
    .filter((m) => m.includes("grill"))
    .map((m) => m.replace("grill ", ""));

if (args.view === "events") {
  const rows: Array<[number, string]> = [];
  for (const event of eventRows()) {
    const message = String(
      ((event as { source?: { message?: unknown } }).source?.message ?? "") as string,
    );
    if (args.timing && !message.includes("grill")) continue;
    rows.push([
      Number((event as { timestamp?: unknown }).timestamp ?? 0),
      message.replace("grill ", ""),
    ]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const [ts, message] of rows) console.log(`${at(ts)}  ${message}`);
  console.log(`# ${rows.length} 行（${args.since}）`);
} else {
  type Invocation = {
    readonly timestamp?: unknown;
    readonly $workers?: {
      readonly wallTimeMs?: number;
      readonly cpuTimeMs?: number;
      readonly event?: { readonly request?: { readonly cf?: { readonly colo?: string } } };
    };
  };
  const rows: Array<[number, number, string, number, number, string[]]> = [];
  for (const events of Object.values(parsed.invocations ?? {})) {
    // The invocation's own line is not always the group's first event (console logs share the group),
    // so find the one carrying the runtime's timing rather than assuming a position.
    const meta = (events as ReadonlyArray<Invocation>).find(
      (e) => e.$workers?.wallTimeMs !== undefined,
    );
    if (!meta?.$workers) continue;
    rows.push([
      Number(meta.timestamp ?? 0),
      meta.$workers.wallTimeMs ?? 0,
      String(meta.$workers.event?.request?.cf?.colo ?? "?"),
      meta.$workers.cpuTimeMs ?? 0,
      events.length,
      messagesOf(events),
    ]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  for (const [ts, wall, colo, cpu, count, timing] of rows) {
    console.log(
      `${at(ts)}  wall ${String(wall).padStart(6)}ms  cpu ${String(cpu).padStart(4)}ms  ${colo}  (${count} lines)`,
    );
    for (const line of timing) console.log(`            ${line}`);
  }
  console.log(`# ${rows.length} 次请求（${args.since}）`);
}
