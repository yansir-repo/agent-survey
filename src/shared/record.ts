/**
 * 访谈的原始记录：题、客户的回答、他的补充、他跳过的题、上传文件的开头。事实只在这里——CONTEXT.md 是 agent 对它的整理（投影），
 * 所以“还有什么没问清”要对着记录判断，不是对着整理稿（整理稿里不会有 agent 没意识到的缺口）。纯函数。
 */
import { isOther, otherText } from "./questions.ts";
import { richText } from "./rich.ts";

export type RecordQuestion = { readonly id: string; readonly title: string; readonly kind: string };
export type RecordAnswer = { readonly skipped: boolean; readonly value: unknown };
export type RecordRound = {
  readonly seq: number;
  readonly kind: string;
  readonly questions: ReadonlyArray<RecordQuestion>;
  readonly answers: Readonly<Record<string, RecordAnswer>>;
  readonly note: string;
};
export type RecordFile = { readonly path: string; readonly head: string };

export const MAX_ANSWER_CHARS = 1500;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

const valueText = (kind: string, v: unknown): string => {
  const one = (x: unknown): string => {
    const s = typeof x === "string" ? x : String(x);
    return isOther(s) ? `（客户自己写的）${otherText(s)}` : s;
  };
  const raw = Array.isArray(v) ? v.map(one).join("；") : one(v);
  return clip(kind === "rich" ? richText(raw) : raw, MAX_ANSWER_CHARS);
};

export const recordText = (
  brief: string,
  rounds: ReadonlyArray<RecordRound>,
  files: ReadonlyArray<RecordFile>,
): string => {
  const parts: string[] = [`# 邀请说明（运营写的背景）\n${brief.trim() || "（无）"}`];
  for (const r of rounds) {
    const lines = r.questions.map((q) => {
      const a = r.answers[q.id];
      const ans =
        a === undefined || a.value === null || a.value === undefined
          ? a?.skipped
            ? "〔客户选了稍后再答〕"
            : "〔没有回答〕"
          : valueText(q.kind, a.value);
      return `Q（${q.kind}）${q.title}\nA ${ans}`;
    });
    parts.push(
      `## 第 ${r.seq} 轮（${r.kind}）\n${lines.join("\n")}${r.note.trim() ? `\n客户在这一轮底部额外写的：${clip(r.note.trim(), MAX_ANSWER_CHARS)}` : ""}`,
    );
  }
  if (files.length > 0)
    parts.push(
      `# 客户上传的文件（只列开头）\n${files.map((f) => `- ${f.path}：${clip(f.head.replace(/\s+/g, " "), 600)}`).join("\n")}`,
    );
  return parts.join("\n\n");
};
