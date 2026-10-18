#!/usr/bin/env node
/**
 * 结束检查者的离线校准：对着已有访谈快照（admin 的 /admin/interviews/<code> 的 JSON）的**原始记录**跑同一个检查者
 * （和 worker 里用的是同一份 record.ts / finish-judge.ts / 提示词），打印它列出的事项。运营命令，花 DeepSeek 额度。
 *   node scripts/finish-judge-eval.mjs --key data/prod-secrets.json --mission profiles/cross-border-website.md --snap /tmp/yan3.json [--snap …]
 * 快照里没有每轮底部的补充（notes），所以结果偏保守地“多列”。
 */
import { readFileSync } from "node:fs";
import { JUDGE_SYSTEM, judgeUser, parseJudge } from "../src/shared/finish-judge.ts";
import { recordText } from "../src/shared/record.ts";

const args = process.argv.slice(2);
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const key = JSON.parse(readFileSync(all("key")[0], "utf8")).DEEPSEEK_API_KEY;
const mission = readFileSync(all("mission")[0], "utf8");

for (const f of all("snap")) {
  const s = JSON.parse(readFileSync(f, "utf8"));
  const rounds = s.rounds.map((r) => ({
    seq: r.seq,
    kind: r.kind,
    questions: r.questions.map((q) => ({ id: q.id, title: q.title, kind: q.kind })),
    answers: Object.fromEntries(
      (r.answers ?? []).map((a) => [
        a.qid ?? a.id,
        { skipped: !!a.skipped, value: a.value ?? null },
      ]),
    ),
    note: "",
  }));
  const record = recordText(s.brief ?? "", rounds, []);
  const t = Date.now();
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: judgeUser(mission, record) },
      ],
    }),
  });
  const j = await res.json();
  const items = parseJudge(j.choices?.[0]?.message?.content ?? "");
  console.log(`\n== ${f}  记录 ${record.length} 字，${Date.now() - t}ms，HTTP ${res.status}`);
  if (!items) {
    console.log("  读不出来：", String(j.choices?.[0]?.message?.content).slice(0, 200));
    continue;
  }
  for (const k of ["askable", "ours", "cannot", "later"])
    for (const i of items.filter((x) => x.kind === k))
      console.log(`  [${k}] ${i.item}${i.ask ? `  ← ${i.ask}` : ""}`);
}
