#!/usr/bin/env node
/**
 * Unattended dogfood: an LLM plays a customer (a persona with a fact sheet) against a running Worker, answering every
 * round the real interviewer asks, so two prompts can be compared on the same customer. Operator command, never part of
 * the gate: it spends model tokens on both sides.
 *
 *   node scripts/dogfood.mjs --base https://… --token <ADMIN_TOKEN> --code cmp-new --persona scripts/personas/steel-cup.md \
 *        [--profile cross-border-website | --mission-file old.md] [--append "…"] [--max-rounds 40] --out /tmp/dogfood/new.json
 *
 * Output: one JSON file with every round (questions, answers, timing), the checkpoints, and the final CONTEXT.md.
 * Only agent rounds count toward --max-rounds (checkpoints and the catch-up round do not).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? d : process.argv[i + 1];
};
const base = arg("base", "http://localhost:5173").replace(/\/$/, "");
const code = arg("code");
const personaFile = arg("persona");
const out = arg("out");
const maxRounds = Number(arg("max-rounds", "40"));
const readVar = (name) =>
  process.env[name] ??
  new RegExp(`^${name}=(.+)$`, "m").exec(readFileSync(".dev.vars", "utf8"))?.[1];
const token = arg("token") ?? readVar("ADMIN_TOKEN");
const llmKey = readVar("DEEPSEEK_API_KEY");
if (!code || !personaFile || !out || !token || !llmKey) {
  console.error("need --code --persona --out and credentials");
  process.exit(2);
}
const persona = readFileSync(personaFile, "utf8");
const brief = arg("brief", "客户：东莞锐杯实业（保温杯工厂）的陈总，想做英文外贸官网。");
const body = {
  code,
  brief,
  ...(arg("profile") ? { profile: arg("profile") } : {}),
  ...(arg("append") ? { append: arg("append") } : {}),
  ...(arg("mission-file") ? { mission: readFileSync(arg("mission-file"), "utf8") } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
const resume = process.argv.includes("--resume");
const created = resume
  ? {
      ok: true,
      profile: "(resumed)",
      ...(await (await admin("GET", `/admin/interviews/${code}`)).json()),
    }
  : await (await admin("POST", "/admin/interviews", body)).json();
if (!created.ok) {
  console.error("create failed", created);
  process.exit(1);
}
const url = created.url.replace(/^https?:\/\/[^/]+/, base);
console.log(`[${code}] ${created.profile} → ${url}`);
const api = async (m, p, b) => {
  const res = await fetch(`${url}/api${p}`, {
    method: m,
    ...(b === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(b) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const askPersona = async (round) => {
  const qs = round.questions.map((q) => ({
    id: q.id,
    kind: q.kind,
    title: q.title,
    why: q.why,
    optional: q.optional === true,
    ...(q.options
      ? {
          options: q.options.map((o) => o.label),
          otherAllowed: `可以写成 "其他：你的话"${q.otherLabel ? `（这里的"其他"含义是：${q.otherLabel}）` : ""}`,
        }
      : {}),
    ...(q.unit ? { unit: q.unit } : {}),
    ...(q.min !== undefined ? { min: q.min } : {}),
    ...(q.max !== undefined ? { max: q.max } : {}),
  }));
  const prompt = `访谈者这一轮的开场白：${round.intro}\n\n这一轮的问题（JSON）：\n${JSON.stringify(qs, null, 1)}\n\n请按你的档案回答。只输出一个 JSON 对象：{"answers": {"<题id>": <答案>}, "skip": ["<要选稍后再答的题id>"], "note": "<这一轮底部想补充的话，没有就空串>"}。\n答案格式：single=选项原文的字符串，或 "其他：你的话"；multi=选项原文的数组（可以加一个 "其他：你的话"）；number=数字；text/long=字符串；rich=字符串；link=网址数组（档案里没有网址就 skip）；image/file=一律 skip。选填(optional)的题不想答可以不放进 answers 也不放进 skip。必答题你不知道时，放进 skip（稍后再答）或者在文字题里老实写“不清楚”。`;
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${llmKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.4,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: persona },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
};

const log = resume
  ? JSON.parse(readFileSync(out, "utf8"))
  : {
      code,
      profile: created.profile,
      base: url.replace(/\/i\/.*/, ""),
      startedAt: new Date().toISOString(),
      rounds: [],
      capped: false,
    };
const save = () => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(log, null, 1));
};
let agentRounds = log.rounds.filter((r) => r.kind === "agent").length;
let lastRound = null;
for (;;) {
  const got = await api("GET", "/state");
  if (got.status !== 200 || !got.data.phase) {
    await sleep(3000); // 偶发的服务端错误：等一下再看
    continue;
  }
  const v = got.data;
  if (v.phase === "done") {
    log.done = true;
    break;
  }
  if (v.phase === "thinking") {
    if (v.error) {
      console.log(`[${code}] agent error → resume`);
      await api("POST", "/resume");
    }
    await sleep(2500);
    continue;
  }
  const r = v.round;
  if (!r) {
    await sleep(1500);
    continue;
  }
  if (lastRound === r.id) {
    await sleep(1500);
    continue;
  }
  if (r.kind === "agent" && agentRounds >= maxRounds) {
    log.capped = true;
    break;
  }
  const t0 = Date.now();
  const ans = await askPersona(r).catch((e) => ({
    answers: {},
    skip: r.questions.filter((q) => !q.optional).map((q) => q.id),
    note: "",
    error: String(e),
  }));
  const done = [];
  for (const q of r.questions) {
    if ((ans.skip ?? []).includes(q.id)) {
      await api("PUT", `/answers/${q.id}`, { skipped: true });
      done.push({ id: q.id, skipped: true });
      continue;
    }
    const val = ans.answers?.[q.id];
    if (val === undefined || val === null || val === "") {
      if (!q.optional) {
        await api("PUT", `/answers/${q.id}`, { skipped: true });
        done.push({ id: q.id, skipped: true, forced: true });
      }
      continue;
    }
    const put = await api("PUT", `/answers/${q.id}`, { value: val });
    if (put.status !== 200) {
      await api("PUT", `/answers/${q.id}`, { skipped: true });
      done.push({ id: q.id, skipped: true, refused: put.data.error });
    } else done.push({ id: q.id, value: val });
  }
  if (ans.note) await api("PUT", `/rounds/${r.id}/note`, { text: ans.note });
  const sub = await api("POST", `/rounds/${r.id}/submit`);
  log.rounds.push({
    id: r.id,
    seq: r.seq,
    kind: r.kind,
    intro: r.intro,
    stage: v.stage,
    questions: r.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      title: q.title,
      why: q.why,
      optional: q.optional === true,
      options: q.options?.map((o) => o.label),
    })),
    answers: done,
    note: ans.note ?? "",
    submit: sub.status,
    personaMs: Date.now() - t0,
    at: new Date().toISOString(),
  });
  if (r.kind === "agent") agentRounds += 1;
  lastRound = r.id;
  console.log(
    `[${code}] ${r.kind} ${r.seq} (${r.questions.length}q) stage=${v.stage ? `${v.stage.number}:${v.stage.round}` : "-"} → ${sub.status}`,
  );
  save();
}
const snap = await (await admin("GET", `/admin/interviews/${code}`)).json();
log.context = snap.context ?? "";
log.summary = snap.summary ?? "";
log.finishedAt = new Date().toISOString();
save();
console.log(`[${code}] ${log.done ? "DONE" : "CAPPED"} after ${agentRounds} agent rounds → ${out}`);
