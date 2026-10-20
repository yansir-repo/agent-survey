/**
 * 发邀请的命令行（给运营侧的 agent 和人）：创建 → 等 → 取结果。输出 JSON（`--pretty` 给人看）。
 * 接口说明在 `node scripts/invite.ts guide`（同一份文字，来自线上 /admin/guide）。
 *
 *   node scripts/invite.ts create --code acme-2026 --brief "客户是…" [--brief-file f.md] [--profile P] [--model M] [--append "…"] [--mission-file f.md]
 *        第二场（开发者访谈）：--from acme-2026 [--code acme-2026-dev]
 *          自动取客户访谈的结果和原始记录；RECORD → source=client，CONTEXT/HANDOFF → source=ours，profile 默认 build-brief。
 *        预置资料（访谈者开问前先读；客户在页面上看得到；文档不限长度，brief 太长就改成文档）：
 *          [--material 客户给的文件]… [--url 客户给的网址]…      出处 = 客户提供的：算客户说过的话，可当 confirm 的依据
 *          [--ours 我们做的调研文件]… [--ours-url 调研网址]…      出处 = 我们的调研：只当线索，不当依据
 *   node scripts/invite.ts list
 *   node scripts/invite.ts result --code acme-2026 [--out CONTEXT.md] [--json-out model.json]
 *         # phase / summary / context / deliverables / unanswered；--json-out 写 JSON 交付物（开发者访谈）
 *   node scripts/invite.ts wait   --code acme-2026 [--timeout 3600] [--every 20]   # 等到 phase = done，再打印结果
 *   node scripts/invite.ts rotate --code acme-2026                        # 换 key，旧链接失效
 *   node scripts/invite.ts delete --code acme-2026 --yes                  # 不可恢复，code 永久作废
 *   node scripts/invite.ts guide | profiles | models
 *
 * 令牌：环境变量 GRILL_ADMIN_TOKEN，否则读 data/prod-secrets.json 或 .dev.vars 里的 ADMIN_TOKEN（都不入库）。
 * 地址：--base 或 GRILL_BASE（默认线上）。
 * 为什么不在门禁里：它要连线上、要运营的令牌，是操作命令。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
/** 重复出现的 --name：每次的值。 */
const all = (name: string): string[] =>
  argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

/** 把一组文件作为同一出处的预置资料传上去。 */
const upload = async (
  code: string,
  source: "client" | "ours",
  paths: string[],
): Promise<unknown> => {
  const form = new FormData();
  form.set("source", source);
  for (const p of paths) {
    if (!existsSync(p)) return fail(`文件不存在：${p}`, 2);
    form.append("file", new Blob([readFileSync(p)]), p.split("/").pop() ?? p);
  }
  const res = await fetch(`${base}/admin/interviews/${code}/materials`, {
    method: "POST",
    headers: { authorization: `Bearer ${token()}` },
    body: form,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `HTTP ${res.status}：${text.slice(0, 200)}` };
  }
};
const need = (name: string): string => flag(name) ?? fail(`缺 --${name}`, 2);
const fileOrFlag = (text: string, file: string): string | undefined =>
  flag(file) !== undefined ? readFileSync(flag(file)!, "utf8") : flag(text);

const result = async (code: string): Promise<Record<string, unknown>> =>
  json("GET", `/admin/interviews/${code}/result`);

/** `--from` 的第二场 code：默认 `<客户 code>-dev`；太长就要求显式 --code。 */
const devCode = (from: string): string => {
  const code = `${from}-dev`;
  if (code.length > 39)
    fail(`默认的开发者 code「${code}」超过 39 个字符，用 --code 指定一个短一点的`, 2);
  return code;
};

/**
 * 从已结束的客户访谈发起第二场（开发者访谈）。
 * 记录放 source=client（客户的话，开发者 agent 的 confirm 能引用），CONTEXT/HANDOFF 放 source=ours（我们的整理）。
 */
const createFrom = async (from: string): Promise<void> => {
  const src = await result(from);
  if (src["phase"] !== "done")
    fail(
      `客户访谈 ${from} 还没结束（phase=${String(src["phase"])}）：等它 done 再发起开发者访谈`,
      1,
    );
  const rec = await json("GET", `/admin/interviews/${from}/record`);
  const code = flag("code") ?? devCode(from);
  const context = String(src["context"] ?? "");
  const summary = String(src["summary"] ?? "");
  const unanswered = Array.isArray(src["unanswered"]) ? src["unanswered"] : [];
  const unansweredLines = unanswered.length
    ? unanswered.map((u) => `- ${String((u as { title?: unknown }).title ?? "")}`).join("\n")
    : "（没有：客户答完了所有题）";
  const operatorBrief = (fileOrFlag("brief", "brief-file") ?? "").trim();
  const brief = [
    `这是 ${from} 的开发者访谈（内部）。客户访谈已经结束。`,
    "先读 provided/client/RECORD.txt.md（客户原话）、provided/ours/CONTEXT.txt.md（我们的整理）、provided/ours/HANDOFF.txt.md（交接说明），再按 build-brief 任务把结构定下来。",
    operatorBrief === "" ? "" : `运营补充：\n${operatorBrief}`,
  ]
    .filter((x) => x !== "")
    .join("\n\n");
  const handoff = `# ${from}：客户访谈 → 开发者访谈

## 客户访谈的结论（访谈者的总结）
${summary.trim() || "（没有总结）"}

## 客户始终没答的题
${unansweredLines}

## 输入
- \`provided/client/RECORD.txt.md\`：客户访谈的原始问答，**客户的话**，是你判断事实的依据。
- \`provided/ours/CONTEXT.txt.md\`：访谈者对客户的理解，**我们的整理**，不是客户的话；和 RECORD 冲突时以 RECORD 为准。
- \`provided/ours/HANDOFF.txt.md\`：本说明。
- \`provided/ours/facts.json.md\`（如果有）：客户访谈的结构化五类事实；是我们的整理，不是客户原话。

## 你的任务
按 \`build-brief\` 预设，先用 \`propose_model\` 提交 \`/model.json\`（机器契约：BSP、内容模型、路由、语言、表单；过 gate 才算数），再把《建站交底》写进 \`CONTEXT.md\`。只问开发者不可逆的决定；不要重新问客户已经答过的事实。

客户访谈如果还有结构化交付物（例如 \`facts.json\`），也在 \`provided/ours/\` 里。

## 注意
这是内部访谈，客户看不到；不要把客户链接或这场的内容发给客户。
`;
  const dir = mkdtempSync(join(tmpdir(), "grill-handoff-"));
  try {
    const recordPath = join(dir, "RECORD.txt");
    const contextPath = join(dir, "CONTEXT.txt");
    const handoffPath = join(dir, "HANDOFF.txt");
    writeFileSync(recordPath, String(rec["text"] ?? ""));
    writeFileSync(contextPath, context);
    writeFileSync(handoffPath, handoff);
    // 客户访谈如果已经有结构化交付物（facts / model），也一并作为“我们的整理”带过去。
    const extras = (
      Array.isArray(src["deliverables"])
        ? (src["deliverables"] as Array<Record<string, unknown>>)
        : []
    )
      .filter(
        (d) =>
          typeof d["path"] === "string" &&
          d["path"] !== "/CONTEXT.md" &&
          typeof d["text"] === "string" &&
          d["text"].trim() !== "",
      )
      .map((d, i) => {
        const name = String(d["path"]).split("/").pop() || `artifact-${i}.json`;
        const path = join(dir, name);
        writeFileSync(path, String(d["text"]));
        return path;
      });
    const created = await json("POST", "/admin/interviews", {
      code,
      brief,
      profile: flag("profile") ?? "build-brief",
      model: flag("model"),
      append: flag("append"),
      mission: fileOrFlag("mission", "mission-file"),
      urls: [
        ...all("url").map((url) => ({ url, source: "client" })),
        ...all("ours-url").map((url) => ({ url, source: "ours" })),
      ],
      start: false,
    });
    const materials = [
      {
        source: "client",
        ...((await upload(code, "client", [recordPath, ...all("material")])) as object),
      },
      {
        source: "ours",
        ...((await upload(code, "ours", [
          contextPath,
          handoffPath,
          ...extras,
          ...all("ours"),
        ])) as object),
      },
    ];
    const started = await json("POST", `/admin/interviews/${code}/start`);
    print({
      ...created,
      from,
      materials,
      extras: extras.length,
      started: started["ok"],
      warnings: unanswered,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

switch (cmd) {
  case "create": {
    const from = flag("from");
    if (from !== undefined) {
      await createFrom(from);
      break;
    }
    const code = need("code");
    const files = { client: all("material"), ours: all("ours") };
    const hasFiles = files.client.length + files.ours.length > 0;
    const urls = [
      ...all("url").map((url) => ({ url, source: "client" })),
      ...all("ours-url").map((url) => ({ url, source: "ours" })),
    ];
    const body = {
      code,
      brief: fileOrFlag("brief", "brief-file") ?? "",
      profile: flag("profile"),
      model: flag("model"),
      append: flag("append"),
      mission: fileOrFlag("mission", "mission-file"),
      urls,
      // 有文件要传：先建好，传完再开始（客户那时看到的是“正在准备”）
      start: !hasFiles,
    };
    const created = await json("POST", "/admin/interviews", body);
    if (!hasFiles) {
      print(created);
      break;
    }
    const materials = [
      ...(files.client.length
        ? [{ source: "client", ...((await upload(code, "client", files.client)) as object) }]
        : []),
      ...(files.ours.length
        ? [{ source: "ours", ...((await upload(code, "ours", files.ours)) as object) }]
        : []),
    ];
    const started = await json("POST", `/admin/interviews/${code}/start`);
    print({ ...created, materials, started: started["ok"] });
    break;
  }
  case "list":
    print(await json("GET", "/admin/interviews"));
    break;
  case "result": {
    const r = await result(need("code"));
    const out = flag("out");
    const jsonOut = flag("json-out");
    if (out) writeFileSync(out, String(r["context"] ?? ""));
    if (jsonOut) {
      const ds = Array.isArray(r["deliverables"])
        ? (r["deliverables"] as Array<Record<string, unknown>>)
        : [];
      const artifact = ds.find((d) => d["format"] === "json" && typeof d["text"] === "string");
      if (!artifact) {
        fail("这个访谈没有 JSON 交付物（--json-out 只给开发者访谈用）", 1);
        break;
      }
      writeFileSync(jsonOut, String(artifact["text"]));
    }
    const ds = Array.isArray(r["deliverables"])
      ? (r["deliverables"] as Array<Record<string, unknown>>)
      : [];
    print({
      ...r,
      deliverables: ds.map((d) => ({
        path: d["path"],
        format: d["format"],
        chars: typeof d["text"] === "string" ? d["text"].length : 0,
      })),
      ...(out ? { context: `（已写入 ${out}）` } : {}),
      ...(jsonOut ? { model: `（已写入 ${jsonOut}）` } : {}),
    });
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
