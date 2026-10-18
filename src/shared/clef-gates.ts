/**
 * clef 的单题布尔判断（实验见 docs/clef-bool-2026-10-18.md）：输入只有一道题的标题和方式，答案是闭合的两选一。
 *   compound  这道题是只问一件事，还是同时问了几件互相独立的事？
 * 发法：每道题一个请求。不要把几个条件合成一个“全满足”的复合问题（实测明显更差）。
 * “作文题能不能改成选择题”这一问已删：一轮最多 1 道作文题是数出来的门，它的阈值又是在一份人工标注上调的，不值得留。
 */
import type { ClefChoice, ClefRequest } from "../worker/clef.ts";

/** P(同时问了好几件事) ≥ 它就退回。阈值在 38 道题的人工标注上选的（P 形最佳 0.55，该拆 0.78 / 一件事 0.20）；线上以被退回的草稿标题复查。 */
export const COMPOUND_AT = 0.55;

export const titleRequest = (title: string, kind: string): ClefRequest => ({
  state: { 题: title, 方式: kind },
  questions: {
    cmp: {
      type: "choice",
      instructions:
        "这道题是在问一件事，还是同时在问几件互相独立的事（回答时要分别回答好几个小问题）？",
      criteria: {
        single: "只问一件事（括号里的举例不算另一件事）",
        multiple: "同时问了两件或更多件互相独立的事",
      },
    },
  },
});

export const readCompound = (answers: Readonly<Record<string, ClefChoice>>): number | null =>
  answers["cmp"]?.probabilities["multiple"] ?? null;

/** 没有可读答案就当没问题。 */
export const compoundProblems = (id: string, p: number | null): ReadonlyArray<string> =>
  p !== null && p >= COMPOUND_AT
    ? [`题 ${id}：看起来同时问了好几件事，拆成几道（能选的做成选择题）`]
    : [];
