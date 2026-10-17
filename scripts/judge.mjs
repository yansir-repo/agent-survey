#!/usr/bin/env node
/**
 * Compare dogfood runs: classifies every question the interviewer asked (is it in the scope of "build a website"?) and
 * scores each run's CONTEXT.md against the same completion criteria, with an LLM judge. Operator command (spends tokens).
 *
 *   node scripts/judge.mjs --a /tmp/dogfood/old.json --b /tmp/dogfood/new.json --out /tmp/dogfood/report.md
 */
import { readFileSync, writeFileSync } from "node:fs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const key =
  process.env.DEEPSEEK_API_KEY ??
  /^DEEPSEEK_API_KEY=(.+)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1];
const named = process.argv.flatMap((a, i, all) => (a === "--run" ? [all[i + 1]] : []));
const runs = named
  .map((spec) => {
    const [name, file] = [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)];
    return { name, file };
  })
  .map((r) => ({ ...r, data: JSON.parse(readFileSync(r.file, "utf8")) }));

const llm = async (system, user) => {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  return JSON.parse((await res.json()).choices[0].message.content);
};

const CATS = {
  A: "访客与决定（谁来、什么处境、在比较什么、怕什么）",
  B: "证据与资产（能证明什么、证书/案例/资料、怎么核实）",
  C: "动作与交接（目标动作、询盘要收什么字段、响应承诺、动作之后发生什么）",
  D: "真实约束（语言、合规、可交付能力、维护、预算、时间）",
  E: "东西与属性（产品/服务的种类、可比较的属性、分类、数量）",
  F: "品味与调性（风格、样例反应）",
  G: "销售流程内部（报价流程、跟单、收款、验货、内部分工——网站范围之外）",
  H: "公司背景（历史、规模、人员、产能——与网站决策没有直接关系）",
  I: "技术资源（域名、空间、账号）",
  J: "其他",
};
const GOAL = `判断标准（要严格）：这次访谈的目的是“做一个外贸网站”。一个问题‘在范围内’，当且仅当它的答案会直接改变：网站上写什么、页面/数据结构、要向客户要的资料、询盘表单字段、网站上对访客的承诺。
下面这类是 G（销售流程内部，范围外），除非问题明确在问“网站上该怎么写/承诺”或“访客要提交什么”，一律 inScope=false：报价由谁算/要不要审批、客户信息怎么存、沟通工具、样品费怎么收的内部规则、打样改几轮、从询盘到收货的内部环节、售后质量问题怎么处理、丢单原因、内部接单底线、团队岗位分工。
下面这类是 H（公司背景，范围外），除非问题是在问“能拿来当证据的东西”：工厂多少人、产能利用率、哪些工序外协、哪年成立。`;

const classify = async (qs) => {
  const out = [];
  for (let i = 0; i < qs.length; i += 25) {
    const batch = qs.slice(i, i + 25);
    const r = await llm(
      `${GOAL}\n把每个问题归入一个类别，并判断它是否在范围内。类别：\n${Object.entries(CATS)
        .map(([k, v]) => `${k} ${v}`)
        .join("\n")}\n只输出 JSON：{"items":[{"n":<序号>,"cat":"A-J","inScope":true|false}]}`,
      batch.map((q, j) => `${j}. ${q.title}（为什么问：${q.why}）`).join("\n"),
    );
    for (const it of r.items) out[i + it.n] = it;
  }
  return out;
};

const CRITERIA = `1. 能把网站每个元素写成“某类访客的某个疑虑 → 用某条证据 → 这条证据对应某个资产（有/要补/给不了）”，空格是被标明的假设。
2. 那个“动作”和交接接口很清楚：访客交出什么、主人多快回应、之后发生什么。
3. 读的人能直接说出：生意在访客眼里有哪些“东西”，访客靠哪些属性比较，怎么分组，哪类很多（要筛选）、哪类很少，访客对它们做什么。
4. 凡是只能假设的（品味、上线后访客行为、客户自己说不清的）都明确写成假设并说明怎么验证。`;
const scoreContext = (ctx) =>
  llm(
    `你是严格的评审。下面是一份访谈产出的 CONTEXT.md，目的是交给“规划网站结构”的人。按四条标准各打 0–3 分（0=完全没有，1=零散，2=基本有但有缺口，3=完整清楚），并估计这份文档里和“做网站”无关的内容（销售流程内部、公司历史等）占多少百分比。只输出 JSON：{"scores":[s1,s2,s3,s4],"offTopicPercent":<0-100>,"gaps":["最主要的 3 个缺口"],"note":"一句话评价"}。\n标准：\n${CRITERIA}`,
    ctx.slice(0, 40000) || "（空）",
  );

const lines = [];
const res = [];
for (const run of runs) {
  const agentRounds = run.data.rounds.filter((r) => r.kind === "agent");
  const qs = agentRounds.flatMap((r) => r.questions.map((q) => ({ ...q, seq: r.seq })));
  const cls = await classify(qs);
  const byCat = {};
  let inScope = 0;
  qs.forEach((q, i) => {
    const c = cls[i]?.cat ?? "J";
    byCat[c] = (byCat[c] ?? 0) + 1;
    if (cls[i]?.inScope) inScope += 1;
  });
  const answers = run.data.rounds.flatMap((r) => r.answers);
  const skipped = answers.filter((a) => a.skipped).length;
  const sc = await scoreContext(run.data.context ?? "");
  res.push({ run, agentRounds, qs, cls, byCat, inScope, skipped, sc });
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
lines.push("# 对比：同一位客户（保温杯工厂老板），同一份提示词\n");
lines.push(
  "| | " + res.map((r) => r.run.name).join(" | ") + " |",
  "|---|" + res.map(() => "---").join("|") + "|",
);
const row = (label, f) => lines.push(`| ${label} | ${res.map(f).join(" | ")} |`);
row("模型", (r) => r.run.data.model || "-");
row("agent 轮数", (r) => String(r.agentRounds.length));
row("平均每轮耗时（秒，含模拟客户）", (r) => {
  const t = (new Date(r.run.data.finishedAt) - new Date(r.run.data.startedAt)) / 1000;
  return r.agentRounds.length ? (t / r.agentRounds.length).toFixed(0) : "-";
});
row("协议摩擦：提问被拒 / 被提醒 / 回合出错", (r) => {
  const st = r.run.data.stats ?? {};
  return `${st.askRefused ?? 0} / ${st.nudges ?? 0} / ${st.turnErrors ?? 0}`;
});
row(
  "检查点被拒 / 结束被拒",
  (r) => `${r.run.data.stats?.checkpointRefused ?? 0} / ${r.run.data.stats?.finishRefused ?? 0}`,
);
row("是否收尾", (r) =>
  r.run.data.done
    ? "自己收尾"
    : r.run.data.capped
      ? `到上限（${r.agentRounds.length} 轮）仍在问`
      : "未结束",
);
row("问题总数", (r) => String(r.qs.length));
row("平均每轮几题", (r) =>
  r.agentRounds.length ? (r.qs.length / r.agentRounds.length).toFixed(1) : "-",
);
row("检查点次数", (r) => String(r.run.data.rounds.filter((x) => x.kind === "checkpoint").length));
row("客户选“稍后再答”的题", (r) => String(r.skipped));
row(
  "**范围内的问题占比**",
  (r) => `**${pct(r.inScope, r.qs.length)}**（${r.inScope}/${r.qs.length}）`,
);
row("销售流程内部（G）占比", (r) => `${pct(r.byCat.G ?? 0, r.qs.length)}（${r.byCat.G ?? 0}）`);
row("公司背景（H）占比", (r) => `${pct(r.byCat.H ?? 0, r.qs.length)}（${r.byCat.H ?? 0}）`);
lines.push(
  "\n## 问题类别分布\n",
  "| 类别 | " + res.map((r) => r.run.name).join(" | ") + " |",
  "|---|" + res.map(() => "---").join("|") + "|",
);
for (const [k, v] of Object.entries(CATS))
  lines.push(
    `| ${k} ${v.split("（")[0]} | ${res.map((r) => String(r.byCat[k] ?? 0)).join(" | ")} |`,
  );
lines.push(
  "\n## CONTEXT.md 评分（0–3，同一把尺）\n",
  "| 标准 | " + res.map((r) => r.run.name).join(" | ") + " |",
  "|---|" + res.map(() => "---").join("|") + "|",
);
["1 证据三元组", "2 动作与交接", "3 东西·属性·动词", "4 假设写明且可验证"].forEach((n, i) =>
  lines.push(`| ${n} | ${res.map((r) => String(r.sc.scores?.[i] ?? "-")).join(" | ")} |`),
);
row("文档里与做网站无关的内容占比", (r) => `${r.sc.offTopicPercent ?? "-"}%`);
row("文档长度（字）", (r) => String((r.run.data.context ?? "").length));
lines.push("\n## 评审意见\n");
for (const r of res)
  lines.push(
    `**${r.run.name}**：${r.sc.note ?? ""}\n- 主要缺口：${(r.sc.gaps ?? []).join("；")}\n`,
  );
lines.push("\n## 范围外的问题举例（各取前 6 条）\n");
for (const r of res) {
  lines.push(`**${r.run.name}**`);
  r.qs
    .map((q, i) => ({ q, c: r.cls[i] }))
    .filter((x) => x.c && !x.c.inScope)
    .slice(0, 6)
    .forEach((x) => lines.push(`- 第 ${x.q.seq} 轮：${x.q.title}`));
  lines.push("");
}
writeFileSync(arg("out") ?? "/tmp/dogfood/report.md", lines.join("\n"));
console.log(lines.join("\n"));
