#!/usr/bin/env node
/**
 * Does clef separate in-scope from out-of-scope questions (and repeats from new questions) on interview text?
 * Runs the deployed /admin/clef-probe over the questions of existing dogfood logs and compares with labels:
 *   out-of-scope  = questions of the OLD-prompt run whose titles match OUT (labelled by hand, see below)
 *   in-scope      = every question of the NEW-preset run
 *   repeats       = questions whose first 12 characters already opened an earlier question in the same run (Haiku log)
 * Operator command (spends Workers AI neurons). Usage: node scripts/clef-eval.mjs --base URL --token T --old old.json --new new.json --haiku h.json
 */
import { readFileSync } from "node:fs";
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const base = arg("base"),
  token = arg("token");
const load = (f) => JSON.parse(readFileSync(f, "utf8"));

// 手工标注（我读过标题）：旧提示词那份里明显是“客户公司内部流程/背景”、不改变网站的题。边界的（看厂比例、丢单原因）不放进来。
const OUT = [
  "工厂现在一共多少人",
  "几个硬数字：哪年成立",
  "团队有几个人",
  "报价是谁算的",
  "客户信息怎么存",
  "样品费怎么收",
  "打样一般要改几轮",
  "会走哪些环节",
  "内部到底怎么想的",
  "质量问题，你们一般怎么处理",
  "什么情况下的小单您愿意接",
  "外购外协",
  "产能利用率",
];

const probe = async (history, qs) => {
  const res = await fetch(`${base}/admin/clef-probe`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ history, questions: qs.map((q) => ({ title: q.title, why: q.why })) }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return data.verdicts;
};
const run = async (log) => {
  const rounds = log.rounds.filter((r) => r.kind === "agent");
  const out = [];
  const history = [];
  for (const r of rounds) {
    const v = await probe(history, r.questions);
    r.questions.forEach((q, i) => out.push({ ...q, seq: r.seq, v: v[i], earlier: [...history] }));
    history.push(...r.questions.map((q) => q.title));
  }
  return out;
};
const stats = (xs) => ({
  n: xs.length,
  mean: xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null,
  readable: xs.length,
});
const old = await run(load(arg("old")));
const neu = await run(load(arg("new")));
const pos = old.filter((q) => OUT.some((k) => q.title.includes(k)) && q.v.outside !== null);
const neg = neu.filter((q) => q.v.outside !== null);
console.log(
  `范围外（人工标注）${pos.length} 题 / 范围内（新预设）${neg.length} 题；clef 不可读的：${old.length + neu.length - pos.length - neg.length - old.filter((q) => !OUT.some((k) => q.title.includes(k))).length}`,
);
console.log(
  "P(范围外) 均值：范围外",
  stats(pos.map((q) => q.v.outside)).mean,
  "范围内",
  stats(neg.map((q) => q.v.outside)).mean,
);
for (const t of [0.5, 0.7, 0.9]) {
  const tp = pos.filter((q) => q.v.outside >= t).length,
    fp = neg.filter((q) => q.v.outside >= t).length;
  console.log(
    `阈值 ${t}: 抓到 ${tp}/${pos.length}（召回 ${Math.round((tp / Math.max(1, pos.length)) * 100)}%），误伤 ${fp}/${neg.length}（${Math.round((fp / Math.max(1, neg.length)) * 100)}%）`,
  );
}
console.log("\n漏掉的范围外（P 最低 5 条）：");
pos
  .sort((a, b) => a.v.outside - b.v.outside)
  .slice(0, 5)
  .forEach((q) => console.log(`  ${q.v.outside.toFixed(2)}  ${q.title.slice(0, 50)}`));
console.log("被误伤的范围内（P 最高 5 条）：");
neg
  .sort((a, b) => b.v.outside - a.v.outside)
  .slice(0, 5)
  .forEach((q) => console.log(`  ${q.v.outside.toFixed(2)}  ${q.title.slice(0, 50)}`));

if (arg("haiku")) {
  const h = await run(load(arg("haiku")));
  const rep = h.filter(
    (q) => q.v.same !== null && q.earlier.some((t) => t.slice(0, 12) === q.title.slice(0, 12)),
  );
  const fresh = h.filter(
    (q) => q.v.same !== null && !q.earlier.some((t) => t.slice(0, 12) === q.title.slice(0, 12)),
  );
  console.log(
    `\n重复检测：重复的 ${rep.length} 题 P(重复) 均值 ${stats(rep.map((q) => q.v.same)).mean}；新问题 ${fresh.length} 题均值 ${stats(fresh.map((q) => q.v.same)).mean}`,
  );
  for (const t of [0.5, 0.7])
    console.log(
      `阈值 ${t}: 抓到 ${rep.filter((q) => q.v.same >= t).length}/${rep.length}，误伤 ${fresh.filter((q) => q.v.same >= t).length}/${fresh.length}`,
    );
}
