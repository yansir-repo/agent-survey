#!/usr/bin/env node
/**
 * End-to-end smoke test: plays a customer against a running Worker (local `vp dev` or deployed), answering every round
 * the real agent asks, until the interview is done. Operator command, never part of the gate: it spends model tokens.
 *
 *   node scripts/play.mjs --base http://localhost:5173 --code smoke-1 [--token <ADMIN_TOKEN>] [--brief "…"] [--max-rounds 6]
 *
 * It creates the interview, skips the first question of every round (to exercise "稍后再答" and the catch-up round),
 * uploads a small text file to file/image questions, and prints what the agent ended up with (result bundle).
 * The token comes from --token, $ADMIN_TOKEN or ./.dev.vars.
 */
import { readFileSync } from "node:fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const base = arg("base", "http://localhost:5173").replace(/\/$/, "");
const code = arg("code", `smoke-${Date.now().toString(36)}`);
const brief = arg("brief", "客户是一家做人行通道闸机的工厂，想做英文外贸站。联系人：张总。");
const maxRounds = Number(arg("max-rounds", "6"));
const token =
  arg("token") ??
  process.env.ADMIN_TOKEN ??
  (() => {
    try {
      return /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1];
    } catch {
      return undefined;
    }
  })();
if (!token) {
  console.error("no admin token (--token, $ADMIN_TOKEN or .dev.vars)");
  process.exit(2);
}

const admin = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const made = await admin("POST", "/admin/interviews", { code, brief });
const created = await made.json();
if (!created.ok) {
  console.error("create failed", created);
  process.exit(1);
}
const url = created.url.replace(/^https?:\/\/[^/]+/, base);
console.log(`interview ${code}: ${url}`);

const api = async (method, path, body) => {
  const res = await fetch(`${url}/api${path}`, {
    method,
    ...(body instanceof FormData
      ? { body }
      : body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const answerFor = async (q) => {
  switch (q.kind) {
    case "single":
      return q.options[0].label;
    case "multi":
      return q.options.slice(0, 2).map((o) => o.label);
    case "number":
      return Math.min(q.max ?? 50, Math.max(q.min ?? 0, 30));
    case "text":
      return "没有";
    case "long":
      return "目前没有特别的要求，按行业常规做就行。";
    case "rich":
      return "<p>我们做<b>三辊闸</b>和<b>摆闸</b>：</p><ul><li>主要卖给工程商</li><li>中东和东南亚</li></ul>";
    case "link":
      return ["https://example.com"];
    case "file":
    case "image": {
      const form = new FormData();
      form.append(
        "file",
        new File(
          [
            `# 资料（${q.id}）\n\n- 三辊闸 A106，304 不锈钢，通行速度 30 人/分钟\n- 摆闸 B208，CE 认证\n`,
          ],
          "notes.md",
          { type: "text/markdown" },
        ),
      );
      const up = await api("POST", `/files?qid=${q.id}`, form);
      const paths = (up.data.results ?? []).filter((r) => r.ok).map((r) => r.path);
      return paths.length ? paths : null;
    }
  }
};

let rounds = 0;
for (;;) {
  const { data: v } = await api("GET", "/state");
  if (v.phase === "done") {
    console.log(
      `DONE after ${rounds} rounds. unanswered:`,
      v.unanswered.map((q) => q.title),
    );
    break;
  }
  if (v.phase === "thinking") {
    if (v.error) {
      console.log("agent error:", v.error, "→ resume");
      await api("POST", "/resume");
    }
    await sleep(2500);
    continue;
  }
  const r = v.round;
  if (rounds++ >= maxRounds) {
    console.log(`stopping after ${maxRounds} rounds (still asking round ${r.seq})`);
    break;
  }
  console.log(`\n== ${r.kind} round ${r.seq}: ${r.intro.slice(0, 80)}`);
  for (const [i, q] of r.questions.entries()) {
    const skip = r.kind === "agent" && i === 0 && r.questions.length > 1;
    if (skip) {
      await api("PUT", `/answers/${q.id}`, { skipped: true });
      console.log(`  - ${q.id} (${q.kind}) → 稍后再答`);
      continue;
    }
    const value = await answerFor(q);
    if (value === null) {
      await api("PUT", `/answers/${q.id}`, { skipped: true });
      console.log(`  - ${q.id} (${q.kind}) → 稍后再答（没答上）`);
      continue;
    }
    const put = await api("PUT", `/answers/${q.id}`, { value });
    console.log(
      `  - ${q.id} (${q.kind}) → ${put.status === 200 ? "ok" : `REFUSED ${JSON.stringify(put.data)}`}`,
    );
  }
  const s = await api("POST", `/rounds/${r.id}/submit`);
  console.log(`  submit → ${s.status} ${s.status === 200 ? "" : JSON.stringify(s.data)}`);
}

const res = await (await admin("GET", `/admin/interviews/${code}/result?format=md`)).text();
console.log("\n--- result ---\n" + res);
