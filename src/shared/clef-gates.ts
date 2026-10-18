/**
 * clef 校验门：DeepSeek 生成问题，clef（封闭判断、一次前向出概率）审它。这里只做纯的部分——怎么把“草拟的一轮”
 * 变成 clef 的请求、怎么把答案读成每道题的判决；调用在 worker/gates.ts。
 *
 *   scope  这道题的答案会不会改变网站（结构、内容、要收的资料、表单字段、对访客的承诺）？会 = changes，不会 = outside
 *   dup    它和已经问过的某道题在问同一件事吗？same / new
 *
 * clef 的输入要短（看板的经验：长输入、模糊问题会接近瞎猜）：任务只取开头一段，已问过的题只取最近 HISTORY 道的标题。
 */
import type { ClefChoice, ClefRequest } from "../worker/clef.ts";

export const HISTORY = 30;
export const MISSION_CHARS = 700;

/** why 不进 clef 的请求：它是出题者自己的辩护，实测会把范围判断带反（有 why：范围外 0.15 < 范围内 0.26；去掉：0.78 > 0.44）。 */
export type Draft = { readonly title: string; readonly why: string };
export type Verdict = {
  /** P(这道题和做网站无关)；clef 没给出可读答案就是 null。 */
  readonly outside: number | null;
  /** P(和已问过的某题重复)。 */
  readonly same: number | null;
};

export const gateRequest = (
  mission: string,
  history: ReadonlyArray<string>,
  drafts: ReadonlyArray<Draft>,
): ClefRequest => ({
  state: {
    任务: mission.replace(/\s+/g, " ").slice(0, MISSION_CHARS),
    已经问过的题: history.slice(-HISTORY),
    草拟的题: drafts.map((d, i) => ({ 编号: `q${i + 1}`, 题: d.title })),
  },
  questions: Object.fromEntries(
    drafts.flatMap((_, i) => [
      [
        `scope_${i + 1}`,
        {
          type: "choice" as const,
          instructions: `只看草拟的题 q${i + 1}：它的答案会不会改变网站的结构、网站上写什么、要向客户收集的资料、询盘表单字段，或者网站对访客的承诺？`,
          criteria: {
            changes: "会改变上面其中一项",
            outside: "不会——这是客户公司内部的销售流程、公司背景或与网站决策无关的事",
          },
        },
      ],
      [
        `dup_${i + 1}`,
        {
          type: "choice" as const,
          instructions: `草拟的题 q${i + 1} 和“已经问过的题”里的某一道，在问同一件事吗？`,
          criteria: { same: "在问同一件事", new: "是一个新的问题" },
        },
      ],
    ]),
  ),
});

export const readVerdicts = (
  answers: Readonly<Record<string, ClefChoice>>,
  count: number,
): ReadonlyArray<Verdict> =>
  Array.from({ length: count }, (_, i) => ({
    outside: answers[`scope_${i + 1}`]?.probabilities["outside"] ?? null,
    same: answers[`dup_${i + 1}`]?.probabilities["same"] ?? null,
  }));

/**
 * 意外检测：我（访谈者）上一轮之后的“理解”里每一条，和客户这一轮的回答是什么关系？
 *   fits 吻合 / overturns 推翻（他说的和这条矛盾）/ adds 补充（他说了这条没有的、会改变它的新东西）/ unrelated 无关
 * 输入保持短：每条理解一句话，回答只放“题目 + 他的答案”。
 */
export type Assumption = { readonly topic: string; readonly text: string };
export type Surprise = { readonly overturns: number | null; readonly adds: number | null };

export const SURPRISE_ANSWER_CHARS = 2500;

export const surpriseRequest = (
  assumptions: ReadonlyArray<Assumption>,
  answers: string,
): ClefRequest => ({
  state: {
    我的理解: assumptions.map((a, i) => ({ 编号: `a${i + 1}`, 主题: a.topic, 内容: a.text })),
    客户这一轮的回答: answers.slice(0, SURPRISE_ANSWER_CHARS),
  },
  questions: Object.fromEntries(
    assumptions.map((_, i) => [
      `rel_${i + 1}`,
      {
        type: "choice" as const,
        instructions: `只看“我的理解”里的 a${i + 1}：客户这一轮的回答和它是什么关系？`,
        criteria: {
          fits: "吻合：他说的和这条一致，或者没有改变它",
          overturns: "推翻：他说的和这条直接矛盾",
          adds: "补充：他说了这条没有覆盖的新事实，会让这条需要改写",
          unrelated: "无关：回答没有涉及这条",
        },
      },
    ]),
  ),
});

export const readSurprise = (
  answers: Readonly<Record<string, ClefChoice>>,
  count: number,
): ReadonlyArray<Surprise> =>
  Array.from({ length: count }, (_, i) => ({
    overturns: answers[`rel_${i + 1}`]?.probabilities["overturns"] ?? null,
    adds: answers[`rel_${i + 1}`]?.probabilities["adds"] ?? null,
  }));
