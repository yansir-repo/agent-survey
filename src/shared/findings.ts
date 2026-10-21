/**
 * agent 的解读（findings）：它读过材料、听完回答之后得出的结论。和受访者的原话**分开放**，并且每条都带可核对的依据：
 *
 *   依据 = 指向记录里的一处 + 逐字引用那一处的一句话。引擎在这里核对这句话真的在那里；找不到就退回给 agent。
 *
 *   answer:<题目id>   受访者对这道题的回答
 *   note:<轮 id>      某一轮底部受访者额外写的话
 *   file:<路径>       受访者上传或提问方预置的文件（转成文字之后）
 *   page:<n>          agent 读过的网页（存进记录的那份）
 *
 * 核对的是“出处”，不是“意思”：结论对不对由读记录的人判断，但没人能把一句话编成受访者说的。纯函数。
 */
import { Schema } from "effect";
import { containsQuote } from "./record.ts";

export const MAX_STATEMENT = 600;
export const MAX_QUOTE = 400;
export const MAX_BASIS = 6;

const Basis = Schema.Struct({
  ref: Schema.String.annotate({
    description: "依据在哪：answer:<题目id> / note:<轮 id> / file:<路径> / page:<n>",
  }),
  quote: Schema.String.annotate({
    description: "那一处里的一句话，逐字抄（不要改写、不要省略中间的字）",
  }),
});
export const FindingInput = Schema.Struct({
  statement: Schema.String.annotate({
    description: "你的结论，一两句话；是解读，不是受访者的原话",
  }),
  basis: Schema.Array(Basis).annotate({ description: `依据，1–${MAX_BASIS} 条` }),
});
export type FindingInput = typeof FindingInput.Type;

export type Basis = typeof Basis.Type;
export type Finding = {
  readonly id: number;
  readonly statement: string;
  readonly basis: ReadonlyArray<Basis>;
  readonly at: number;
};

/** 记录里能查到文字的地方；查不到返回 null。 */
export type Sources = {
  readonly answer: (qid: string) => string | null;
  readonly note: (roundId: string) => string | null;
  readonly file: (path: string) => string | null;
  readonly page: (n: string) => string | null;
};

const decode = Schema.decodeUnknownResult(FindingInput, { onExcessProperty: "error" });
const REF = /^(answer|note|file|page):(.+)$/;

export const checkFinding = (
  raw: unknown,
  sources: Sources,
):
  | { readonly ok: true; readonly value: FindingInput }
  | { readonly ok: false; readonly error: string } => {
  const r = decode(raw);
  if (r._tag !== "Success")
    return { ok: false, error: "结论的格式不对：要 statement（一句结论）和 basis（依据数组）" };
  const input = r.success;
  const statement = input.statement.trim();
  if (statement === "") return { ok: false, error: "结论是空的" };
  if (statement.length > MAX_STATEMENT)
    return { ok: false, error: `结论太长（最多 ${MAX_STATEMENT} 个字）` };
  if (input.basis.length === 0)
    return { ok: false, error: "解读必须有依据：至少指向记录里的一处，并引用一句话" };
  if (input.basis.length > MAX_BASIS) return { ok: false, error: `依据最多 ${MAX_BASIS} 条` };
  for (const b of input.basis) {
    const m = REF.exec(b.ref.trim());
    if (!m)
      return {
        ok: false,
        error: `依据的位置写法不对：${b.ref}（要 answer:<题目id> / note:<轮 id> / file:<路径> / page:<n>）`,
      };
    const text = sources[m[1] as keyof Sources](m[2]!);
    if (text === null) return { ok: false, error: `记录里没有 ${b.ref}` };
    const quote = b.quote.trim();
    if (quote === "" || quote.length > MAX_QUOTE)
      return { ok: false, error: `${b.ref} 的引文要 1–${MAX_QUOTE} 个字` };
    if (!containsQuote(text, quote))
      return {
        ok: false,
        error: `${b.ref} 里找不到这句话：「${quote.slice(0, 40)}」。逐字抄原文，别改写`,
      };
  }
  return {
    ok: true,
    value: {
      statement,
      basis: input.basis.map((b) => ({ ref: b.ref.trim(), quote: b.quote.trim() })),
    },
  };
};
