#!/usr/bin/env node
/**
 * Same questions, same state, two instruments: Cloudflare's clef-flash (via the deployed /admin/clef-probe) and TypeSafe's
 * Jev (direct). Follows the can-jev-do method: a control that is decidable without the model gates the run; the contrast is
 * read at matched false-positive rates, never at a matched threshold. Operator command (spends tokens on both sides).
 *
 *   node scripts/jev-vs-clef.mjs --base URL --token T --keyfile /path/.dev.vars --mission profiles/cross-border-website.md \
 *        --old /tmp/dogfood/old.json --new /tmp/dogfood/new.json --haiku /tmp/bench/claude-haiku-5-5.json
 * The key is read from the file and never printed.
 */
import { readFileSync } from "node:fs";
import { gateRequest, readVerdicts } from "../src/shared/clef-gates.ts";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const base = arg("base"),
  token = arg("token");
const key = /^TYPESAFE_API_KEY=(.*)$/m
  .exec(readFileSync(arg("keyfile"), "utf8"))?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!key) {
  console.error("no TYPESAFE_API_KEY in keyfile");
  process.exit(2);
}
const mission = readFileSync(arg("mission"), "utf8");
const load = (f) => JSON.parse(readFileSync(f, "utf8"));
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

const clef = async (history, drafts) => {
  const r = await fetch(`${base}/admin/clef-probe`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      mission,
      history,
      questions: drafts.map((d) => ({ title: d.title, why: "" })),
    }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error("clef " + JSON.stringify(d));
  return d.verdicts;
};
const jev = async (history, drafts) => {
  const req = gateRequest(
    mission,
    history,
    drafts.map((d) => ({ title: d.title, why: "" })),
  );
  for (let a = 1; a <= 4; a++) {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", ...req }),
    });
    if (r.ok) {
      const body = await r.json();
      const answers = Object.fromEntries(
        Object.entries(body.answers ?? {}).map(([k, v]) => [
          k,
          v && v.type === "choice" ? { probabilities: v.probabilities } : v,
        ]),
      );
      globalThis.__jevModel = body.model;
      return readVerdicts(answers, drafts.length);
    }
    if (![429, 500, 502, 503, 504].includes(r.status) || a === 4)
      throw new Error(`jev HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 800 * 2 ** a));
  }
};

// ---- control: decidable without judgement ----
{
  const hist = ["你们现在最主要的客户是哪一类？", "询盘表单要收哪些字段？"];
  const probe = [
    { title: "你们现在最主要的客户是哪一类？" },
    { title: "今天天气怎么样，要不要带伞？" },
  ];
  const [c, j] = [await clef(hist, probe), await jev(hist, probe)];
  const ok = (v) => v[0].same >= 0.9 && v[1].same <= 0.3;
  console.log(
    `控制（逐字重复应≥0.9，无关应≤0.3）：clef ${c.map((x) => x.same?.toFixed(2))}  jev ${j.map((x) => x.same?.toFixed(2))}  [${globalThis.__jevModel}]`,
  );
  if (!ok(j)) {
    console.error("Jev 没过控制，不读对比");
    process.exit(1);
  }
  if (!ok(c)) console.log("注意：clef 没过控制（对比仍读，但把它当成 clef 的第一条证据）");
}

const run = async (log) => {
  const out = [],
    history = [];
  for (const r of log.rounds.filter((x) => x.kind === "agent")) {
    const [c, j] = [await clef(history, r.questions), await jev(history, r.questions)];
    r.questions.forEach((q, i) =>
      out.push({ title: q.title, earlier: [...history], clef: c[i], jev: j[i] }),
    );
    history.push(...r.questions.map((q) => q.title));
  }
  return out;
};
/** recall at matched false-positive rate (score ≥ the (1-fp) quantile of negatives). */
const recallAt = (pos, neg, fp) => {
  const s = [...neg].sort((a, b) => b - a);
  const cut = s[Math.max(0, Math.floor(s.length * fp) - 1)] ?? 1;
  const thr = fp === 0 ? Infinity : cut + 1e-9;
  return pos.filter((x) => x >= thr).length / pos.length;
};
const auc = (pos, neg) =>
  pos.flatMap((p) => neg.map((n) => (p > n ? 1 : p === n ? 0.5 : 0))).reduce((a, b) => a + b, 0) /
  (pos.length * neg.length);
const report = (name, pos, neg, f) => {
  console.log(`\n${name}：正例 ${pos.length} / 负例 ${neg.length}`);
  for (const inst of ["clef", "jev"]) {
    const p = pos.map((x) => f(x[inst])),
      n = neg.map((x) => f(x[inst]));
    console.log(
      `  ${inst.padEnd(4)} AUC ${auc(p, n).toFixed(2)}  召回@FP10% ${(recallAt(p, n, 0.1) * 100).toFixed(0)}%  @20% ${(recallAt(p, n, 0.2) * 100).toFixed(0)}%  @30% ${(recallAt(p, n, 0.3) * 100).toFixed(0)}%`,
    );
  }
};

const old = await run(load(arg("old"))),
  neu = await run(load(arg("new")));
const pos = old.filter(
  (q) => OUT.some((k) => q.title.includes(k)) && q.clef.outside !== null && q.jev.outside !== null,
);
const neg = neu.filter((q) => q.clef.outside !== null && q.jev.outside !== null);
report("范围（范围外 vs 新预设的题）", pos, neg, (v) => v.outside);

if (arg("haiku")) {
  const h = (await run(load(arg("haiku")))).filter(
    (q) => q.clef.same !== null && q.jev.same !== null,
  );
  const dup = h.filter((q) => q.earlier.some((t) => t.slice(0, 12) === q.title.slice(0, 12)));
  const fresh = h.filter((q) => !q.earlier.some((t) => t.slice(0, 12) === q.title.slice(0, 12)));
  report("重复（前 12 字相同 vs 新题）", dup, fresh, (v) => v.same);
}
