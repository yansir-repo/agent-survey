/**
 * 等待时能看到什么：agent 一边想一边出题，系统把这两股流（推理文字、ask_round 的参数 JSON）转成客户端能画的东西。
 * 纯函数：把“到目前为止收到的半截 JSON”补全成能解析的 JSON，再取出已经成形的题。不进数据库，只活在 Durable Object 的内存里
 * （回合中断时它也跟着没了，不需要恢复）。
 */
import { Schema } from "effect";

const parse = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
const parsed = (s: string): { ok: true; value: unknown } | { ok: false } => {
  const r = parse(s);
  return r._tag === "Success" ? { ok: true, value: r.success } : { ok: false };
};

/** 给半截 JSON 补上缺的引号和括号；末尾停在键或冒号上就往回退，直到能解析为止。 */
export const completeJson = (partial: string): unknown => {
  let s = partial;
  for (let trim = 0; trim < 60 && s.length > 0; trim++) {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const c of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }
    const closed = s + (esc ? "\\" : "") + (inStr ? '"' : "") + stack.reverse().join("");
    const r = parsed(closed);
    if (r.ok) return r.value;
    s = s.slice(0, -1);
  }
  return undefined;
};

export type LiveQuestion = {
  readonly title: string;
  readonly kind: string;
  readonly options: ReadonlyArray<string>;
  /** 最后一道还在写。 */
  readonly writing: boolean;
};
export type LiveView = {
  /** 推理文字的尾部（只看最近一段）。 */
  readonly reasoning: string;
  readonly intro: string;
  readonly questions: ReadonlyArray<LiveQuestion>;
  /** 它刚刚在干什么（读资料、打开网页、记笔记……），最近几条。 */
  readonly activity: ReadonlyArray<string>;
};

export const REASONING_TAIL = 700;

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** reasoning = 到目前为止的推理文字；args = ask_round 到目前为止收到的参数文字（没有就空）。 */
export const liveView = (
  reasoning: string,
  args: string,
  activity: ReadonlyArray<string> = [],
): LiveView => {
  const tail =
    reasoning.length > REASONING_TAIL ? `…${reasoning.slice(-REASONING_TAIL)}` : reasoning;
  const root = args === "" ? undefined : completeJson(args);
  const list = isObject(root) && Array.isArray(root["questions"]) ? root["questions"] : [];
  const questions = list
    .filter(isObject)
    .map((q, i, all) => ({
      title: str(q["title"]),
      kind: str(q["kind"]),
      options: (Array.isArray(q["options"]) ? q["options"] : [])
        .filter(isObject)
        .map((o) => str(o["label"]))
        .filter((l) => l !== ""),
      writing: i === all.length - 1,
    }))
    .filter((q) => q.title !== "");
  return { reasoning: tail, intro: isObject(root) ? str(root["intro"]) : "", questions, activity };
};
