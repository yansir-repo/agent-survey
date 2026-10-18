#!/usr/bin/env node
/**
 * Offline look at clef's surprise gate: for each round k of a dogfood log, the interviewer's stated understanding
 * (shown with round k) is compared by clef against the customer's answers to round k; next to it the interviewer's own
 * `delta` (written with round k+1) says what it thinks changed. Operator command (spends Workers AI neurons).
 *   node scripts/clef-surprise-eval.mjs --base URL --token T --log /tmp/exp/s2-ground-8.json
 */
import { readFileSync } from "node:fs";
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const log = JSON.parse(readFileSync(arg("log"), "utf8"));
const fmt = (v) => (Array.isArray(v) ? v.join("、") : String(v ?? "（稍后再答）"));
for (let k = 0; k < log.stored.length - 1; k++) {
  const s = log.stored[k];
  const r = log.rounds.find((x) => x.id === s.id);
  if (s.kind !== "agent" || !s.understanding?.length || !r?.answers?.length) continue;
  const answers = r.questions
    .map((q) => `${q.title}\n→ ${fmt(r.answers.find((a) => a.id === q.id)?.value)}`)
    .join("\n\n");
  const res = await fetch(`${arg("base")}/admin/clef-surprise`, {
    method: "POST",
    headers: { authorization: `Bearer ${arg("token")}`, "content-type": "application/json" },
    body: JSON.stringify({ assumptions: s.understanding, answers }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.log(`第 ${s.seq} 轮：clef 失败 ${JSON.stringify(data)}`);
    continue;
  }
  console.log(
    `\n== 第 ${s.seq} 轮的回答 → 第 ${s.seq + 1} 轮的 delta：${(log.stored[k + 1].delta ?? "").slice(0, 160)}`,
  );
  s.understanding.forEach((u, i) => {
    const v = data.verdicts[i];
    console.log(
      `  推翻 ${v.overturns?.toFixed(2)} 补充 ${v.adds?.toFixed(2)}  [${u.topic}] ${u.text.slice(0, 70)}`,
    );
  });
}
