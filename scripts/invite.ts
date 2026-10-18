/**
 * 发邀请的命令行（给运营侧的 agent 和人）：创建 → 等 → 取结果。输出 JSON（`--pretty` 给人看）。
 * 接口说明在 `node scripts/invite.ts guide`（同一份文字，来自线上 /admin/guide）。
 *
 *   node scripts/invite.ts create --code acme-2026 --brief "客户是…" [--brief-file f.md] [--profile P] [--model M] [--append "…"] [--mission-file f.md]
 *   node scripts/invite.ts list
 *   node scripts/invite.ts result --code acme-2026 [--out CONTEXT.md]     # phase / summary / context / unanswered
 *   node scripts/invite.ts wait   --code acme-2026 [--timeout 3600] [--every 20]   # 等到 phase = done，再打印结果
 *   node scripts/invite.ts rotate --code acme-2026                        # 换 key，旧链接失效
 *   node scripts/invite.ts delete --code acme-2026 --yes                  # 不可恢复，code 永久作废
 *   node scripts/invite.ts guide | profiles | models
 *
 * 令牌：环境变量 GRILL_ADMIN_TOKEN，否则读 data/prod-secrets.json 或 .dev.vars 里的 ADMIN_TOKEN（都不入库）。
 * 地址：--base 或 GRILL_BASE（默认线上）。
 * 为什么不在门禁里：它要连线上、要运营的令牌，是操作命令。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_BASE = "https://grill-me.yansir.workers.dev";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const has = (name: string): boolean => argv.includes(`--${name}`);
const pretty = has("pretty");

const fail = (message: string, code = 1): never => {
  console.error(message);
  return process.exit(code);
};

const token = (): string => {
  const fromEnv = process.env["GRILL_ADMIN_TOKEN"];
  if (fromEnv) return fromEnv;
  if (existsSync("data/prod-secrets.json")) {
    const t = (
      JSON.parse(readFileSync("data/prod-secrets.json", "utf8")) as { ADMIN_TOKEN?: string }
    ).ADMIN_TOKEN;
    if (t) return t;
  }
  if (existsSync(".dev.vars")) {
    const m = /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"));
    if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return fail(
    "没有找到 ADMIN_TOKEN：设环境变量 GRILL_ADMIN_TOKEN，或放进 data/prod-secrets.json / .dev.vars",
  );
};

const base = (flag("base") ?? process.env["GRILL_BASE"] ?? DEFAULT_BASE).replace(/\/$/, "");
const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
};
const print = (value: unknown): void =>
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));
/** JSON 接口：失败（非 2xx 或 ok:false）时打印服务器的话，退出码 1。 */
const json = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> => {
  const { status, text } = await call(method, path, body);
  const data = (() => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `HTTP ${status}：${text.slice(0, 200)}` };
    }
  })();
  if (status >= 400 || data["ok"] === false) {
    print(data);
    return process.exit(1);
  }
  return data;
};
const need = (name: string): string => flag(name) ?? fail(`缺 --${name}`, 2);
const fileOrFlag = (text: string, file: string): string | undefined =>
  flag(file) !== undefined ? readFileSync(flag(file)!, "utf8") : flag(text);

const result = async (code: string): Promise<Record<string, unknown>> =>
  json("GET", `/admin/interviews/${code}/result`);

switch (cmd) {
  case "create": {
    const body = {
      code: need("code"),
      brief: fileOrFlag("brief", "brief-file") ?? "",
      profile: flag("profile"),
      model: flag("model"),
      append: flag("append"),
      mission: fileOrFlag("mission", "mission-file"),
    };
    print(await json("POST", "/admin/interviews", body));
    break;
  }
  case "list":
    print(await json("GET", "/admin/interviews"));
    break;
  case "result": {
    const r = await result(need("code"));
    if (flag("out")) writeFileSync(flag("out")!, String(r["context"] ?? ""));
    print(flag("out") ? { ...r, context: `（已写入 ${flag("out")}）` } : r);
    break;
  }
  case "wait": {
    const code = need("code");
    const deadline = Date.now() + Number(flag("timeout") ?? "3600") * 1000;
    const every = Number(flag("every") ?? "20") * 1000;
    for (;;) {
      const r = await result(code);
      if (r["phase"] === "done") {
        print(r);
        break;
      }
      if (Date.now() > deadline) {
        print({ ok: false, timedOut: true, phase: r["phase"], rounds: r["rounds"] });
        process.exit(3);
      }
      console.error(`… ${code}：${String(r["phase"])}，已 ${String(r["rounds"])} 轮`);
      await new Promise((resolve) => setTimeout(resolve, every));
    }
    break;
  }
  case "rotate":
    print(await json("POST", `/admin/interviews/${need("code")}/rotate`));
    break;
  case "delete":
    if (!has("yes")) fail("删除不可恢复（code 永久作废）：确认要删就加 --yes", 2);
    print(await json("DELETE", `/admin/interviews/${need("code")}`));
    break;
  case "guide": {
    const { status, text } = await call("GET", "/admin/guide");
    if (status !== 200) fail(`HTTP ${status}：${text.slice(0, 200)}`);
    console.log(text);
    break;
  }
  case "profiles":
    print(await json("GET", "/admin/profiles"));
    break;
  case "models":
    print(await json("GET", "/admin/models"));
    break;
  default:
    fail(
      "用法：node scripts/invite.ts <create|list|result|wait|rotate|delete|guide|profiles|models> [--code C] …\n先看 `node scripts/invite.ts guide`。",
      2,
    );
}
