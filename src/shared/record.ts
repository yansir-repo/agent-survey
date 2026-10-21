/**
 * 访谈的原始记录的**文本形态**：背景、每一轮的题和受访者的回答、他的补充、他跳过的题、上传文件的开头。
 * 验收（finish-judge）和“依据”的机械核对都对着它：事实只在这里，agent 的解读（findings）不是。纯函数。
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

export const valueText = (kind: string, v: unknown): string => {
  const one = (x: unknown): string => {
    const s = typeof x === "string" ? x : String(x);
    return isOther(s) ? `（受访者自己写的）${otherText(s)}` : s;
  };
  const raw = Array.isArray(v) ? v.map(one).join("；") : one(v);
  return clip(kind === "rich" ? richText(raw) : raw, MAX_ANSWER_CHARS);
};

export const recordText = (
  brief: string,
  rounds: ReadonlyArray<RecordRound>,
  files: ReadonlyArray<RecordFile>,
): string => {
  const parts: string[] = [`# 背景（提问方写的）\n${brief.trim() || "（无）"}`];
  for (const r of rounds) {
    const lines = r.questions.map((q) => {
      const a = r.answers[q.id];
      const ans =
        a === undefined || a.value === null || a.value === undefined
          ? a?.skipped
            ? `〔受访者选了稍后再答，编号 ${q.id}〕`
            : "〔没有回答〕"
          : valueText(q.kind, a.value);
      return `Q（${q.kind}）${q.title}\nA ${ans}`;
    });
    parts.push(
      `## 第 ${r.seq} 轮（${r.kind}）\n${lines.join("\n")}${r.note.trim() ? `\n受访者在这一轮底部额外写的：${clip(r.note.trim(), MAX_ANSWER_CHARS)}` : ""}`,
    );
  }
  if (files.length > 0)
    parts.push(
      `# 受访者上传的文件（只列开头）\n${files.map((f) => `- ${f.path}：${clip(f.head.replace(/\s+/g, " "), 600)}`).join("\n")}`,
    );
  return parts.join("\n\n");
};

/** 记录文本里“这句话在不在”：忽略空白差异（受访者的原话可能被折行、被富文本改过空白）。 */
export const squash = (s: string): string => s.replace(/\s+/g, "");
export const containsQuote = (text: string, quote: string): boolean => {
  const q = squash(quote);
  return q.length > 0 && squash(text).includes(q);
};
