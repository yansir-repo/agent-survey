/**
 * clef 的两道“单题布尔判断”（实验见 docs/clef-bool-2026-10-18.md）：输入只有一道题的标题和方式，答案是闭合的两选一。
 *   compound  这道题是只问一件事，还是同时问了几件互相独立的事？
 *   pick      这道题的答案，客户能不能从事先猜得到的选项里选出来？（只用于作文题 long / rich）
 * 发法：每道题一个请求，两个条件并列（P 形）。实测 S（一条件一请求）略准、B（全部合一个请求）明显变差，见实验文档。
 */
import type { ClefChoice, ClefRequest } from "../worker/clef.ts";

/** P(同时问了好几件事) ≥ 它就退回。实验里 P 形的最佳阈值 0.55（该拆 0.78 / 一件事 0.20）。 */
export const COMPOUND_AT = 0.55;
/** P(能改成选择题) ≥ 它就让出题者改成选择题。概率整体偏低（能选 0.23 / 得写 0.03），阈值取 0.15。 */
export const PICK_AT = 0.15;

export type TitleVerdict = { readonly compound: number | null; readonly pick: number | null };

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
    pick: {
      type: "choice",
      instructions:
        "这道题的答案，客户能不能从 3–6 个可以事先猜到的选项里直接选出来（而不是要讲自己的具体情况）？",
      criteria: {
        pick: "能：常见答案可以猜出来，选一个就行",
        write: "不能：答案是他自己的具体事实、数字、故事或理由，没法事先猜",
      },
    },
  },
});

export const readTitle = (answers: Readonly<Record<string, ClefChoice>>): TitleVerdict => ({
  compound: answers["cmp"]?.probabilities["multiple"] ?? null,
  pick: answers["pick"]?.probabilities["pick"] ?? null,
});

/** 判决 → 给出题者的话（没有问题就是空）。clef 没给出可读答案的那一项当作没问题。 */
export const titleProblems = (id: string, kind: string, v: TitleVerdict): ReadonlyArray<string> => [
  ...(v.compound !== null && v.compound >= COMPOUND_AT
    ? [`题 ${id}：看起来同时问了好几件事，拆成几道（能选的做成选择题）`]
    : []),
  ...((kind === "long" || kind === "rich") && v.pick !== null && v.pick >= PICK_AT
    ? [
        `题 ${id}：这题的答案客户多半能从几个选项里选出来——猜 3–6 个选项改成单选/多选（都不符合时他会自己写）`,
      ]
    : []),
];
