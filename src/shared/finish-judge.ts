/**
 * 结束前的验收：agent 说“问完了”，如果这场访谈有验收条款，就由一位独立的检查者**对每一条条款单独判一次**——
 * 记录里能不能找到依据说明它成立。依据必须是记录里的一句原话，引擎在这里机械核对它真的出现在记录里；找不到就当不成立。
 *
 * 为什么一条一问：实测里“把条件合成一个全满足的复合问题”读不稳，单个布尔判断可靠（docs/clef-bool-2026-10-18.md）。
 *
 * 失败模型和限制：检查者可能误判。所以：不满足的条款最多拦结束 MAX_FINISH_BLOCKS 次，之后放行并把没满足的写进记录；
 * 检查者不可用 = 放行并计数。没有验收条款 = 不验证。取消条件：有一批标好的真实访谈证明检查者准确率很高，再考虑加大预算。
 */
import { Schema } from "effect";
import { containsQuote } from "./record.ts";

export const MAX_FINISH_BLOCKS = 2;

export const CRITERION_SYSTEM = `你是一次访谈的验收检查者。你会拿到：这场访谈的目标，**一条**验收条款，以及受访者的**原始问答记录**——每一轮的题、受访者的回答、他在每轮底部额外写的话、他选了“稍后再答”或没回答的题、他上传文件的开头。

你只判断这一条：记录里能不能找到依据，说明它成立。
- 依据只来自这份记录里受访者的回答、他补充的话、他提供的文件。题目本身、背景、你的推测都不算依据。
- 成立（met = true）：必须引用记录里的一句话作为依据（evidence），**逐字**抄，不要改写、不要省略中间的字。
- 不成立或没有依据（met = false）：evidence 写 null；note 用一句话说明缺什么。

只输出一个 JSON 对象，不要别的字：
{"met": true|false, "evidence": "记录里的一句原话，或 null", "note": "一句话"}`;

export const criterionUser = (goal: string, criterion: string, record: string): string =>
  `# 目标\n${goal.trim()}\n\n# 验收条款\n${criterion}\n\n# 原始问答记录\n${record}`;

const Verdict = Schema.Struct({
  met: Schema.Boolean,
  evidence: Schema.optionalKey(Schema.NullOr(Schema.String)),
  note: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Verdict));

export type Judged = {
  readonly criterion: string;
  readonly met: boolean;
  readonly evidence: string | null;
  readonly note: string;
};

/** 检查者的原话 → 一条的结论；读不出来返回 null（当作检查者不可用）。 */
export const parseVerdict = (text: string, criterion: string, record: string): Judged | null => {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const r = decode(body);
  if (r._tag !== "Success") return null;
  const { met, evidence, note } = r.success;
  const quote = (evidence ?? "").trim();
  if (!met) return { criterion, met: false, evidence: null, note: (note ?? "").trim() };
  // 成立必须有依据，依据必须真的在记录里：这是引擎自己核对的，不信检查者的转述。
  if (quote === "")
    return { criterion, met: false, evidence: null, note: "没有给出依据，当作不成立" };
  if (!containsQuote(record, quote))
    return { criterion, met: false, evidence: null, note: "给出的依据在记录里找不到，当作不成立" };
  return { criterion, met: true, evidence: quote, note: (note ?? "").trim() };
};

/** 拦结束的条款：不成立的那些。 */
export const unmetOf = (judged: ReadonlyArray<Judged>): ReadonlyArray<Judged> =>
  judged.filter((j) => !j.met);

/** 退回时对 agent 说的话：就是没满足的条款。 */
export const finishRefusal = (unmet: ReadonlyArray<Judged>, left: number): string =>
  `还不能结束。独立检查者只按受访者的原始回答核对验收条款，下面这几条在记录里找不到依据：\n${unmet
    .map((j, n) => `${n + 1}. ${j.criterion}${j.note ? `（${j.note}）` : ""}`)
    .join(
      "\n",
    )}\n\n用 ask_round 去问（选择题、数字题怎么轻怎么来），问完再结束。这位检查者最多再拦你 ${left} 次——别指望靠重复调用 finish_interview 通过。`;
