/**
 * 结束前的验收：agent 说“问完了”，由一位独立的检查者对着**原始记录**（不是 CONTEXT.md）和任务的完成判据，
 * 找出“客户现在就能答或能给、答案会改变交付物、记录里却还没有”的事。有就退回，理由就是这份清单。
 *
 * 失败模型和限制：检查者可能误报（凭空列出事项）。所以：只有 askable 拦结束；最多拦 MAX_FINISH_BLOCKS 次，之后放行并把剩下的
 * 记成“未解决”；检查者不可用 = 放行并计数。取消条件：有一批标好的真实访谈证明它的 askable 准确率很高，再考虑加大预算。
 */
import { Schema } from "effect";

export const MAX_FINISH_BLOCKS = 2;
export const MAX_ASKABLE = 6;

export const JUDGE_SYSTEM = `你是一次访谈的验收检查者。你会拿到：任务说明（含这次访谈的目的和“完成的判据”），以及客户的**原始问答记录**——每一轮的题、客户的回答、他在每轮底部额外写的话、他选了“稍后再答”或没回答的题、他上传文件的开头。

你看不到访谈者自己写的整理文档，也不该相信它：事实只来自这份记录。

你的工作：按任务的目的和完成判据，找出“记录里还没有、但下一步用到交付物时要用到”的事，并把每一件归入一类：
- askable：客户**现在就能**回答或提供（一个选择、一个数字、一句话、上传一份文件），而且缺了它，下一步就得回头去找客户。
- ours：需要我方去做的事（整理、设计、翻译、核对……），不用问客户。
- cannot：客户已经明确说没有、不知道、不愿意，或者选了稍后再答、没回答——不要再追。
- later：只能在上线或交付之后才能验证的事（应当已经被当作假设）。

判 askable 要保守：这件事的缺失，会不会让下一步不得不回头找客户？不会就不列。宁可少列，不要为了凑数列。已经在记录里回答过的，不列。

只输出一个 JSON 对象，不要别的字：
{"open":[{"item":"这件事是什么","kind":"askable|ours|cannot|later","ask":"只对 askable 写：建议怎么问（选择题/数字/一句话/上传文件）"}]}
没有就输出 {"open":[]}。askable 最多 ${MAX_ASKABLE} 条，最重要的在前。`;

export const judgeUser = (mission: string, record: string): string =>
  `# 任务说明\n${mission.trim()}\n\n# 原始问答记录\n${record}`;

const Item = Schema.Struct({
  item: Schema.String,
  kind: Schema.Literals(["askable", "ours", "cannot", "later"]),
  ask: Schema.optionalKey(Schema.String),
});
export type OpenItem = typeof Item.Type;
const Out = Schema.Struct({ open: Schema.Array(Item) });
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Out));

/** 检查者的原话 → 清单；读不出来返回 null（当作检查者不可用）。 */
export const parseJudge = (text: string): ReadonlyArray<OpenItem> | null => {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const r = decode(body);
  return r._tag === "Success" ? r.success.open : null;
};

export const askableOf = (items: ReadonlyArray<OpenItem>): ReadonlyArray<OpenItem> =>
  items.filter((i) => i.kind === "askable").slice(0, MAX_ASKABLE);

/** 退回时对 agent 说的话：就是那份清单。 */
export const finishRefusal = (items: ReadonlyArray<OpenItem>, left: number): string =>
  `还不能结束。独立检查者只按客户的原始回答核对，发现这几件事客户现在就能答或能给、而你还没问：\n${items
    .map((i, n) => `${n + 1}. ${i.item}${i.ask ? `（建议：${i.ask}）` : ""}`)
    .join(
      "\n",
    )}\n\n用 ask_round 去问（选择题、数字题、上传文件都行），问完再结束。这位检查者最多再拦你 ${left} 次——别指望靠重复调用 finish_interview 通过。`;
