#!/usr/bin/env node
/**
 * 布尔判断实验：clef 判“这道题是否该拆 / 能不能改成选择题”，四种发法对比（同一批题、同一份人工标签）。
 *   S 每个(题×条件)一个请求   P 每道题一个请求（两个条件并列）   B 全部题×条件一个请求   C 一个“全部满足”的复合问题
 * 标签是我读过标题后手标的（self-authored，只能当上限）。运营命令，花 Workers AI 额度。
 *   node scripts/clef-bool-exp.mjs --base URL --token T --log /tmp/yan.json
 */
import { readFileSync } from "node:fs";
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const base = arg("base"),
  token = arg("token");
const snap = JSON.parse(readFileSync(arg("log"), "utf8"));
const qs = snap.rounds.flatMap((r) => r.questions);

const T = new Set([
  0, 1, 2, 3, 4, 7, 9, 11, 12, 13, 14, 16, 18, 20, 24, 26, 27, 28, 29, 32, 33, 36, 37,
]);
const compoundLabel = (i) => T.has(i);
const PICK = new Set([3, 6, 10, 15, 16, 17, 19, 20, 22, 25, 30, 32, 33, 35, 37]);
const WRITE = new Set([1, 2, 9, 11, 13, 14, 27, 28, 29]);
const pickLabel = (i) => (PICK.has(i) ? true : WRITE.has(i) ? false : null);

const CQ = {
  type: "choice",
  instructions:
    "这道题是在问一件事，还是同时在问几件互相独立的事（回答时要分别回答好几个小问题）？",
  criteria: {
    single: "只问一件事（括号里的举例不算另一件事）",
    multiple: "同时问了两件或更多件互相独立的事",
  },
};
const PQ = {
  type: "choice",
  instructions:
    "这道题的答案，客户能不能从 3–6 个可以事先猜到的选项里直接选出来（而不是要讲自己的具体情况）？",
  criteria: {
    pick: "能：常见答案可以猜出来，选一个就行",
    write: "不能：答案是他自己的具体事实、数字、故事或理由，没法事先猜",
  },
};
const AQ = {
  type: "choice",
  instructions:
    "这道题是否同时满足：(1) 只问一件事；(2) 客户能从 3–6 个可以事先猜到的选项里直接选出答案？",
  criteria: { all: "两条都满足", notall: "至少一条不满足" },
};

const call = async (state, questions) => {
  const t = Date.now();
  const r = await fetch(`${base}/admin/clef-ask`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state, questions }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(JSON.stringify(d));
  return { a: d.answers, ms: Date.now() - t };
};
const pool = async (items, n, f) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await f(items[k], k);
      }
    }),
  );
  return out;
};
const p = (a, key, cls) => a[key]?.probabilities?.[cls] ?? null;

const t0 = Date.now();
// S
const S = await pool(
  qs.map((_, i) => i),
  4,
  async (i) => {
    const st = { 题: qs[i].title, 方式: qs[i].kind };
    const [c, k] = await Promise.all([call(st, { q: CQ }), call(st, { q: PQ })]);
    return { cmp: p(c.a, "q", "multiple"), pick: p(k.a, "q", "pick"), ms: c.ms + k.ms };
  },
);
const tS = Date.now() - t0;
// P
const t1 = Date.now();
const P = await pool(
  qs.map((_, i) => i),
  4,
  async (i) => {
    const r = await call({ 题: qs[i].title, 方式: qs[i].kind }, { cmp: CQ, pick: PQ });
    return { cmp: p(r.a, "cmp", "multiple"), pick: p(r.a, "pick", "pick") };
  },
);
const tP = Date.now() - t1;
// B
const t2 = Date.now();
const titles = Object.fromEntries(qs.map((q, i) => [`q${i}`, `${q.title}（方式：${q.kind}）`]));
const idx = qs.map((_, i) => i);
const B = new Array(qs.length);
for (const chunk of [idx.slice(0, 32), idx.slice(32)]) {
  const questions = {};
  for (const i of chunk) {
    questions[`cmp_${i}`] = { ...CQ, instructions: `只看题 q${i}：` + CQ.instructions };
    questions[`pick_${i}`] = { ...PQ, instructions: `只看题 q${i}：` + PQ.instructions };
  }
  const r = await call(
    { 题目: Object.fromEntries(chunk.map((i) => [`q${i}`, titles[`q${i}`]])) },
    questions,
  );
  for (const i of chunk)
    B[i] = { cmp: p(r.a, `cmp_${i}`, "multiple"), pick: p(r.a, `pick_${i}`, "pick") };
}
const tB = Date.now() - t2;
// C
const C = await pool(idx, 4, async (i) => {
  const r = await call({ 题: qs[i].title, 方式: qs[i].kind }, { q: AQ });
  return { all: p(r.a, "q", "all") };
});

const auc = (pos, neg) => {
  if (!pos.length || !neg.length) return NaN;
  let s = 0;
  for (const x of pos) for (const y of neg) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (pos.length * neg.length);
};
const rep = (name, arm, key, label, flip = false) => {
  const rows = idx
    .map((i) => ({ s: arm[i][key], y: label(i) }))
    .filter((r) => r.y !== null && r.s !== null);
  const pos = rows.filter((r) => r.y).map((r) => r.s),
    neg = rows.filter((r) => !r.y).map((r) => r.s);
  const acc = rows.filter((r) => r.s >= 0.5 === r.y).length / rows.length;
  let best = { t: 0.5, a: 0 };
  for (let t = 0.05; t < 1; t += 0.05) {
    const a2 = rows.filter((r) => r.s >= t === r.y).length / rows.length;
    if (a2 > best.a) best = { t, a: a2 };
  }
  console.log(
    `  ${name.padEnd(4)} n=${rows.length} AUC ${auc(pos, neg).toFixed(2)}  准确率@0.5 ${(acc * 100).toFixed(0)}%  最佳阈值 ${best.t.toFixed(2)} → ${(best.a * 100).toFixed(0)}%（正例均值 ${(pos.reduce((a1, b1) => a1 + b1, 0) / pos.length).toFixed(2)}，负例 ${(neg.reduce((a1, b1) => a1 + b1, 0) / neg.length).toFixed(2)}）`,
  );
};
console.log(
  `\n【该拆吗】标签：该拆 ${[...idx].filter(compoundLabel).length} / 一件事 ${idx.length - [...idx].filter(compoundLabel).length}`,
);
rep("S", S, "cmp", compoundLabel);
rep("P", P, "cmp", compoundLabel);
rep("B", B, "cmp", compoundLabel);
console.log(`\n【能改选择题吗】标签：能选 ${PICK.size} / 得自己写 ${WRITE.size}`);
rep("S", S, "pick", pickLabel);
rep("P", P, "pick", pickLabel);
rep("B", B, "pick", pickLabel);
const both = (i) => (pickLabel(i) === null ? null : !compoundLabel(i) && pickLabel(i));
console.log(`\n【全满足（只问一件事 且 能选）】`);
rep("C", C, "all", both);
const mad = (A, Bm, k) =>
  (idx.reduce((s, i) => s + Math.abs(A[i][k] - Bm[i][k]), 0) / idx.length).toFixed(3);
console.log(
  `\n一致性（平均绝对差）S↔P cmp ${mad(S, P, "cmp")} pick ${mad(S, P, "pick")} | S↔B cmp ${mad(S, B, "cmp")} pick ${mad(S, B, "pick")}`,
);
console.log(
  `耗时：S ${tS}ms（${qs.length * 2} 个请求，并发 4） P ${tP}ms（${qs.length} 个） B ${tB}ms（2 个）`,
);
