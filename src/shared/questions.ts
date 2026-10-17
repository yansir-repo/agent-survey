/**
 * 问题的词表：agent 每道题自己决定交互方式，但方式是一个**封闭集合**——它能问什么，由这里一处决定。
 * 同一份 Schema 同时是：TS 类型、agent 的工具入参（JSON Schema）、客户端渲染的依据。
 *
 *   Question = id × title × why × 方式（single | multi | number | text | long | rich | link | image | file）
 *   Answer   = 与方式对应的值；客户可以不答（稍后再答），所以“没有答案”是一等状态，不是错误。
 *
 * 没有 archive / video：MVP 不支持（见 AGENTS.md）。要加一种方式，就在这里加一项、在 validateAnswer 里加一条规则。
 */
import { Schema } from "effect";
import { sanitizeRich, richText } from "./rich.ts";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,40}$/));
const Short = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));

const Option = Schema.Struct({ label: Short(80), hint: Schema.optionalKey(Short(120)) });
const Options = Schema.Array(Option).check(Schema.isMinLength(2), Schema.isMaxLength(8));

const base = {
  id: Id,
  /** 问题本身，客户读到的那句话。 */
  title: Short(300),
  /** 为什么问：一句话说明这题的用途（客户愿意回答的前提）。 */
  why: Short(300),
};

const Single = Schema.Struct({ kind: Schema.Literal("single"), ...base, options: Options });
const Multi = Schema.Struct({ kind: Schema.Literal("multi"), ...base, options: Options });
const Num = Schema.Struct({
  kind: Schema.Literal("number"),
  ...base,
  unit: Schema.optionalKey(Short(20)),
  min: Schema.optionalKey(Schema.Number),
  max: Schema.optionalKey(Schema.Number),
});
const text = (kind: "text" | "long" | "rich") =>
  Schema.Struct({
    kind: Schema.Literal(kind),
    ...base,
    placeholder: Schema.optionalKey(Short(200)),
  });
const Link = Schema.Struct({
  kind: Schema.Literal("link"),
  ...base,
  max: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))),
});
const upload = (kind: "image" | "file") =>
  Schema.Struct({
    kind: Schema.Literal(kind),
    ...base,
    // 没有 hint：能收什么格式由 files.ts 一处决定，agent 不能在这里许诺系统收不了的格式
    max: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 }))),
  });

export const Question = Schema.Union([
  Single,
  Multi,
  Num,
  text("text"),
  text("long"),
  text("rich"),
  Link,
  upload("image"),
  upload("file"),
]);
export type Question = typeof Question.Type;
export type QuestionKind = Question["kind"];
export const QUESTION_KINDS = [
  "single",
  "multi",
  "number",
  "text",
  "long",
  "rich",
  "link",
  "image",
  "file",
] as const satisfies ReadonlyArray<QuestionKind>;

export const MAX_QUESTIONS_PER_ROUND = 5;

/** agent 一轮问什么：1–5 题，加一句开场白，以及“我现在的理解”（让客户纠错，不是进度）。 */
export const AskRound = Schema.Struct({
  intro: Short(400),
  understanding: Schema.optionalKey(
    Schema.Array(Schema.Struct({ topic: Short(40), text: Short(300) })).check(
      Schema.isMaxLength(8),
    ),
  ),
  questions: Schema.Array(Question).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_QUESTIONS_PER_ROUND),
  ),
});
export type AskRound = typeof AskRound.Type;

const decodeAsk = Schema.decodeUnknownResult(AskRound, { onExcessProperty: "error" });

/** 一轮提问的入口检查：结构对、id 不重复、不和以前问过的 id 撞。失败是 agent 读得懂的话。 */
export const parseAskRound = (
  input: unknown,
  usedIds: ReadonlySet<string>,
): { ok: true; round: AskRound } | { ok: false; error: string } => {
  const r = decodeAsk(input);
  if (r._tag !== "Success")
    return {
      ok: false,
      error: String(r.failure)
        .replace(/^SchemaError\(/, "")
        .slice(0, 900),
    };
  const seen = new Set<string>();
  for (const q of r.success.questions) {
    if (seen.has(q.id)) return { ok: false, error: `题目 id 重复：${q.id}` };
    if (usedIds.has(q.id)) return { ok: false, error: `题目 id ${q.id} 以前用过，换一个新的` };
    seen.add(q.id);
  }
  return { ok: true, round: r.success };
};

// ---- 答案 ----

/** 答案的值：文字/数字/选项（单选一个、多选多个）/ 链接们 / 上传文件的路径们。富文本存的是净化后的 HTML。 */
export type Value = string | number | ReadonlyArray<string>;

export const MAX_TEXT = 500;
export const MAX_LONG = 8000;
export const MAX_RICH = 20000;
export const MAX_FILES_DEFAULT = 10;

export const uploadDir = (qid: string): string => `uploads/${qid}/`;

const isUrl = (s: string): boolean => {
  if (!URL.canParse(s)) return false;
  const u = new URL(s);
  return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
};

export type Checked =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };
const bad = (error: string): Checked => ({ ok: false, error });
const good = (value: Value): Checked => ({ ok: true, value });

/**
 * 一个答案对这道题是不是合法的：纯函数，客户端（提交前）和服务端（落库前）问的是同一个问题，答案只在这里。
 * 返回的 value 是规范化后的（去首尾空白、富文本净化、数字转成 number）。
 */
export const validateAnswer = (q: Question, raw: unknown): Checked => {
  switch (q.kind) {
    case "single": {
      if (typeof raw !== "string") return bad("单选的答案是一个选项");
      return q.options.some((o) => o.label === raw) ? good(raw) : bad("不是这道题的选项");
    }
    case "multi": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string"))
        return bad("多选的答案是一组选项");
      const picked = [...new Set(raw as string[])];
      if (picked.length === 0) return bad("至少选一个");
      return picked.every((p) => q.options.some((o) => o.label === p))
        ? good(picked)
        : bad("有不是这道题选项的值");
    }
    case "number": {
      const n =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw)
            : NaN;
      if (!Number.isFinite(n)) return bad("要填一个数字");
      if (q.min !== undefined && n < q.min) return bad(`不能小于 ${q.min}`);
      if (q.max !== undefined && n > q.max) return bad(`不能大于 ${q.max}`);
      return good(n);
    }
    case "text": {
      if (typeof raw !== "string") return bad("要填文字");
      const t = raw.trim().replace(/\s*\n\s*/g, " ");
      return t === ""
        ? bad("不能是空的")
        : t.length > MAX_TEXT
          ? bad(`最多 ${MAX_TEXT} 个字`)
          : good(t);
    }
    case "long": {
      if (typeof raw !== "string") return bad("要填文字");
      const t = raw.trim();
      return t === ""
        ? bad("不能是空的")
        : t.length > MAX_LONG
          ? bad(`最多 ${MAX_LONG} 个字`)
          : good(t);
    }
    case "rich": {
      if (typeof raw !== "string") return bad("要填文字");
      const html = sanitizeRich(raw);
      if (richText(html) === "") return bad("不能是空的");
      return html.length > MAX_RICH ? bad("内容太长了") : good(html);
    }
    case "link": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string"))
        return bad("链接是一组网址");
      const urls = [...new Set((raw as string[]).map((u) => u.trim()).filter(Boolean))];
      if (urls.length === 0) return bad("至少一个网址");
      if (urls.length > (q.max ?? 5)) return bad(`最多 ${q.max ?? 5} 个`);
      const wrong = urls.find((u) => !isUrl(u));
      return wrong ? bad(`不像网址：${wrong}`) : good(urls);
    }
    case "image":
    case "file": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return bad("要上传文件");
      const paths = [...new Set(raw as string[])];
      if (paths.length === 0) return bad("还没有上传文件");
      if (paths.length > (q.max ?? MAX_FILES_DEFAULT))
        return bad(`最多 ${q.max ?? MAX_FILES_DEFAULT} 个文件`);
      return paths.every((p) => p.startsWith(uploadDir(q.id)) && !p.includes(".."))
        ? good(paths)
        : bad("文件不属于这道题");
    }
  }
};
