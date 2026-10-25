/**
 * 发邀请的命令行（给提问方的 agent 和人）：创建 → 等 → 取记录。输出 JSON（`--pretty` 给人看）。
 * 接口说明在 `node scripts/invite.ts guide`（同一份文字，来自线上 /admin/guide）。
 *
 *   node scripts/invite.ts create --code acme-2026 --brief "背景…" [--brief-file f.md] [--template T] [--model M]
 *        [--goal-file f.md] [--append "…"] [--criteria-file c.json] [--respondent "…"] [--intro "…"] [--language 中文]
 *        [--max-rounds N] [--per-round N] [--no-uploads] [--no-web] [--no-search] [--notify https://…]
 *        预置资料（访谈者开问前先读；受访者在页面上看得到；文档不限长度，brief 太长就改成文档）：
 *          [--material 文件]… [--url 网址]…            出处 = respondent：受访者提供的，算他说过的话，可当 confirm 的依据
 *          [--inquirer 调研文件]… [--inquirer-url 网址]…  出处 = inquirer：提问方做的调研，只当线索，不当依据
 *   node scripts/invite.ts list
 *   node scripts/invite.ts result --code acme-2026 [--out record.json] [--md record.md]   # 记录；没结束时也能取
 *   node scripts/invite.ts wait   --code acme-2026 [--timeout 3600] [--every 20]   # 等到 phase = done，再打印记录
 *   node scripts/invite.ts rotate --code acme-2026                        # 换 key，旧链接失效
 *   node scripts/invite.ts delete --code acme-2026 --yes                  # 不可恢复，code 永久作废
 *   node scripts/invite.ts guide | templates | models
 *
 * 令牌：环境变量 GRILL_ADMIN_TOKEN，否则读 data/prod-secrets.json 或 .dev.vars 里的 ADMIN_TOKEN（都不入库）。
 * 地址：--base 或 GRILL_BASE（默认线上）。
 * 为什么不在门禁里：它要连线上、要提问方的令牌，是操作命令。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const DEFAULT_BASE = "https://agent-survey.yansir.workers.dev";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "";
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const all = (name: string): string[] =>
  argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
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
const auth = () => ({ Authorization: `Bearer ${token()}` });
const print = (v: unknown) => console.log(JSON.stringify(v, null, pretty ? 2 : 0));

const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...auth(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // 说明书等 Markdown 响应不是 JSON
  }
  return { status: res.status, json };
};

const upload = async (code: string, source: "respondent" | "inquirer", files: string[]) => {
  const form = new FormData();
  form.set("source", source);
  for (const f of files) form.append("file", new Blob([readFileSync(f)]), basename(f));
  const res = await fetch(`${base}/admin/interviews/${code}/materials`, {
    method: "POST",
    headers: auth(),
    body: form,
  });
  return res.json() as Promise<unknown>;
};

const num = (name: string): number | undefined => {
  const v = flag(name);
  return v === undefined ? undefined : Number(v);
};

const create = async () => {
  const code = flag("code") ?? fail("create 要 --code");
  const brief = flag("brief-file")
    ? readFileSync(flag("brief-file")!, "utf8")
    : (flag("brief") ?? "");
  const files = { respondent: all("material"), inquirer: all("inquirer") };
  const urls = [
    ...all("url").map((url) => ({ url, source: "respondent" })),
    ...all("inquirer-url").map((url) => ({ url, source: "inquirer" })),
  ];
  const hasFiles = files.respondent.length + files.inquirer.length > 0;
  const pace = {
    ...(num("max-rounds") ? { maxRounds: num("max-rounds") } : {}),
    ...(num("per-round") ? { perRound: num("per-round") } : {}),
  };
  const capabilities = {
    ...(has("no-uploads") ? { uploads: false } : {}),
    ...(has("no-web") ? { web: false } : {}),
    ...(has("no-search") ? { search: false } : {}),
  };
  const body = {
    code,
    brief,
    ...(flag("template") ? { template: flag("template") } : {}),
    ...(flag("model") ? { model: flag("model") } : {}),
    ...(flag("goal-file") ? { goal: readFileSync(flag("goal-file")!, "utf8") } : {}),
    ...(flag("append") ? { append: flag("append") } : {}),
    ...(flag("criteria-file")
      ? { criteria: JSON.parse(readFileSync(flag("criteria-file")!, "utf8")) as unknown }
      : {}),
    ...(flag("respondent") ? { respondent: flag("respondent") } : {}),
    ...(flag("intro") ? { intro: flag("intro") } : {}),
    ...(flag("language") ? { language: flag("language") } : {}),
    ...(flag("notify") ? { notify: flag("notify") } : {}),
    ...(Object.keys(pace).length ? { pace } : {}),
    ...(Object.keys(capabilities).length ? { capabilities } : {}),
    ...(urls.length ? { urls } : {}),
    // 有文件要先放：先建好，放完再 start
    ...(hasFiles ? { start: false } : {}),
  };
  const made = await call("POST", "/admin/interviews", body);
  if (made.status !== 201) return { ok: false, status: made.status, ...(made.json as object) };
  const uploads = [];
  for (const source of ["respondent", "inquirer"] as const)
    if (files[source].length)
      uploads.push({ source, ...((await upload(code, source, files[source])) as object) });
  if (hasFiles) await call("POST", `/admin/interviews/${code}/start`);
  return { ...(made.json as object), ...(uploads.length ? { uploads } : {}) };
};

const result = async (code: string) => {
  const r = await call("GET", `/admin/interviews/${code}/result`);
  if (r.status !== 200) return fail(`取记录失败（${r.status}）：${JSON.stringify(r.json)}`);
  if (flag("out")) writeFileSync(flag("out")!, JSON.stringify(r.json, null, 2));
  if (flag("md")) {
    const md = await fetch(`${base}/admin/interviews/${code}/result?format=md`, {
      headers: auth(),
    });
    writeFileSync(flag("md")!, await md.text());
  }
  return r.json;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const wait = async (code: string) => {
  const deadline = Date.now() + (num("timeout") ?? 3600) * 1000;
  for (;;) {
    const r = (await call("GET", `/admin/interviews/${code}/result`)).json as { phase?: string };
    if (r.phase === "done") return result(code);
    if (Date.now() > deadline) return fail("等得太久了（--timeout）", 3);
    await sleep((num("every") ?? 20) * 1000);
  }
};

const main = async () => {
  const code = flag("code") ?? "";
  if (cmd === "create") return print(await create());
  if (cmd === "list") return print((await call("GET", "/admin/interviews")).json);
  if (cmd === "result") return print(await result(code || fail("result 要 --code")));
  if (cmd === "wait") return print(await wait(code || fail("wait 要 --code")));
  if (cmd === "rotate")
    return print(
      (await call("POST", `/admin/interviews/${code || fail("rotate 要 --code")}/rotate`)).json,
    );
  if (cmd === "delete") {
    if (!has("yes")) return fail("delete 不可恢复：加 --yes 确认");
    return print(
      (await call("DELETE", `/admin/interviews/${code || fail("delete 要 --code")}`)).json,
    );
  }
  if (cmd === "templates") return print((await call("GET", "/admin/templates")).json);
  if (cmd === "models") return print((await call("GET", "/admin/models")).json);
  if (cmd === "guide") return console.log((await call("GET", "/admin/guide")).json);
  return fail(
    `用法：node scripts/invite.ts <create|list|result|wait|rotate|delete|guide|templates|models> …（见文件头）`,
    2,
  );
};

await main();
