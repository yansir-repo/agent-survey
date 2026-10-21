import { Effect } from "effect";
/**
 * 记录（bundle）：访谈结束时交回的东西。**尽量原始**：每一轮的题和给出的选项、受访者的回答、他和提问方给的材料、
 * agent 读过的网页，以及 agent 看过之后的解读（和原话分开放，带可核对的依据）。拿它去干什么，不归这里管。
 *
 * 这里只做“把存下来的东西摆成一份形状固定的 JSON”，不判断、不总结。`digest` 由调用方在 Worker 里算（要 WebCrypto）：
 * 它是整份记录规范化之后的 sha-256，下游可以用它确认拿到的是同一份。
 */
import type { Finding } from "./findings.ts";
import type { Judged } from "./finish-judge.ts";
import { sourceOfQid } from "./provided.ts";
import type { Question } from "./questions.ts";
import type { Spec } from "./templates.ts";

export type BundleQuestion = {
  readonly id: string;
  readonly kind: Question["kind"];
  readonly title: string;
  readonly why: string;
  /** explore / guess / confirm；检查点题没有。 */
  readonly mode: string | null;
  readonly resolves: string | null;
  /** confirm 题的依据：受访者的一句原话。 */
  readonly basis: string | null;
  readonly optional: boolean;
  /** 给出的选项（single / multi）；其他题型没有。 */
  readonly options: ReadonlyArray<{ readonly label: string; readonly hint: string | null }> | null;
};

export type BundleAnswer = {
  readonly qid: string;
  /** 受访者留下的值，原样：选项文字、数字、文字、网址数组、文件路径数组…… */
  readonly value: unknown;
  /** 他选了“稍后再答”。 */
  readonly skipped: boolean;
};

export type BundleRound = {
  readonly seq: number;
  readonly kind: "agent" | "deferred" | "checkpoint";
  readonly intro: string;
  /** agent 写的“这一轮相对上一轮变了什么”（解读，不是原话）。 */
  readonly delta: string | null;
  readonly questions: ReadonlyArray<BundleQuestion>;
  readonly answers: ReadonlyArray<BundleAnswer>;
  /** 受访者在这一轮底部额外写的话。 */
  readonly note: string;
};

export type MaterialSource = "respondent" | "inquirer" | "uploaded" | "fetched";
export type BundleMaterial = {
  /** 记录里引用它的编号：`file:<path>` 或 `page:<n>`。 */
  readonly ref: string;
  readonly source: MaterialSource;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  /** ok = 已转成文字；unconverted = 收下了但没能转；网页都是 ok。 */
  readonly status: "ok" | "unconverted";
  /** 哪道题上传的（`uploaded`）；预置的是出处标记。 */
  readonly qid: string;
  readonly r2Key: string | null;
  readonly url: string | null;
};

export type FinishedBy = "agent" | "deferred-round" | null;

export type Bundle = {
  readonly id: string;
  readonly phase: "thinking" | "asking" | "done";
  readonly template: Spec["template"];
  /** 创建时快照的原文：目标、背景、受访者说明、语言。 */
  readonly goal: string;
  readonly brief: string;
  readonly respondent: string;
  readonly language: string;
  readonly model: string;
  readonly rounds: ReadonlyArray<BundleRound>;
  readonly materials: ReadonlyArray<BundleMaterial>;
  /** agent 的解读：不是受访者的话。 */
  readonly findings: ReadonlyArray<Finding>;
  /** agent 结束时留的一两句话。 */
  readonly summary: string;
  /** 稍后再答之后仍没答的题。 */
  readonly unanswered: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  /** 验收：每条条款的结论和依据；没有条款就是 null。 */
  readonly validation: {
    readonly criteria: ReadonlyArray<Judged>;
    /** 结束被拦过几次。 */
    readonly blocked: number;
    /** 放行时仍不满足的条款（拦满之后放行）。 */
    readonly unmet: ReadonlyArray<string>;
  } | null;
  readonly finishedBy: FinishedBy;
};

export type BundleInput = Omit<Bundle, "materials" | "finishedBy"> & {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly name: string;
    readonly mime: string;
    readonly size: number;
    readonly qid: string;
    readonly status: "ok" | "unconverted";
    readonly r2Key: string;
  }>;
  readonly pages: ReadonlyArray<{
    readonly n: number;
    readonly url: string;
    readonly size: number;
  }>;
  readonly deferredRoundOpened: boolean;
};

export const questionOf = (q: Question): BundleQuestion => ({
  id: q.id,
  kind: q.kind,
  title: q.title,
  why: q.why,
  mode: q.mode ?? null,
  resolves: q.resolves ?? null,
  basis: q.basis ?? null,
  optional: q.optional === true,
  options:
    q.kind === "single" || q.kind === "multi"
      ? q.options.map((o) => ({ label: o.label, hint: o.hint ?? null }))
      : null,
});

export const buildBundle = (i: BundleInput): Bundle => {
  const { files, pages, deferredRoundOpened, ...rest } = i;
  const materials: BundleMaterial[] = [
    ...files.map((f): BundleMaterial => {
      const given = sourceOfQid(f.qid);
      return {
        ref: `file:${f.path}`,
        source: given ?? "uploaded",
        name: f.name,
        mime: f.mime,
        size: f.size,
        status: f.status,
        qid: f.qid,
        r2Key: f.r2Key,
        url: null,
      };
    }),
    ...pages.map((p): BundleMaterial => ({
      ref: `page:${p.n}`,
      source: "fetched",
      name: p.url,
      mime: "text/markdown",
      size: p.size,
      status: "ok",
      qid: "",
      r2Key: null,
      url: p.url,
    })),
  ];
  return {
    ...rest,
    materials,
    finishedBy: rest.phase === "done" ? (deferredRoundOpened ? "deferred-round" : "agent") : null,
  };
};

/** 人读的版本：由记录机械渲染，不经过任何模型。 */
export const bundleMarkdown = (b: Bundle): string => {
  const out: string[] = [
    `# 访谈记录 ${b.id}`,
    `模板：${b.template.name} v${b.template.version}　阶段：${b.phase}`,
  ];
  out.push(`## 目标\n${b.goal.trim() || "（无）"}`);
  out.push(`## 背景（提问方写的）\n${b.brief.trim() || "（无）"}`);
  for (const r of b.rounds) {
    const lines = r.questions.map((q) => {
      const a = r.answers.find((x) => x.qid === q.id);
      const opts = q.options ? `\n  选项：${q.options.map((o) => o.label).join(" / ")}` : "";
      const ans =
        a === undefined ? "〔没有回答〕" : a.skipped ? "〔稍后再答〕" : JSON.stringify(a.value);
      return `- Q ${q.id}（${q.kind}${q.mode ? `，${q.mode}` : ""}）${q.title}${opts}\n  A ${ans}`;
    });
    out.push(
      `## 第 ${r.seq} 轮（${r.kind}）\n${lines.join("\n")}${r.note.trim() ? `\n- 底部补充：${r.note.trim()}` : ""}`,
    );
  }
  if (b.materials.length > 0)
    out.push(
      `## 材料\n${b.materials.map((m) => `- ${m.ref}（${m.source}，${m.name}，${m.status}）`).join("\n")}`,
    );
  if (b.findings.length > 0)
    out.push(
      `## agent 的解读（不是受访者的话）\n${b.findings
        .map(
          (f) =>
            `- ${f.statement}\n${f.basis.map((x) => `  - ${x.ref}：「${x.quote}」`).join("\n")}`,
        )
        .join("\n")}`,
    );
  if (b.unanswered.length > 0)
    out.push(`## 没答的\n${b.unanswered.map((u) => `- ${u.id}：${u.title}`).join("\n")}`);
  if (b.validation)
    out.push(
      `## 验收\n${b.validation.criteria.map((c) => `- ${c.met ? "✓" : "✗"} ${c.criterion}${c.evidence ? `（依据：「${c.evidence}」）` : c.note ? `（${c.note}）` : ""}`).join("\n")}`,
    );
  return out.join("\n\n");
};

/** 整份记录的 sha-256（十六进制）：规范化 = JSON，不含 `digest` 自己。 */
export const digestOf = (b: Bundle): Effect.Effect<string> =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(b))),
  ).pipe(
    Effect.map((hash) =>
      [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join(""),
    ),
  );
