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
  /**
   * 选填：客户可以不写，也不用“稍后再答”——空着就是空着，不会被补问。要写“可留空”就用这个，别写进题目里。
   * （“稍后再答”是另一回事：那是客户想答但现在答不了，系统会补问。）
   */
  optional: Schema.optionalKey(Schema.Boolean),
  /**
   * 出题者的自检（agent 发起的题必填，系统自己生成的检查点题没有）：
   *   resolves 这题消除的是哪一处“不问我就得编”的地方；
   *   mode     explore = 我对这块没有依据，听客户自己说；confirm = 选项来自客户说过的话，在验证一个假设；
   *   basis    confirm 必填：客户（或邀请说明里）的原话，逐字——系统会在他说过的话里找它。
   */
  resolves: Schema.optionalKey(Short(200)),
  mode: Schema.optionalKey(Schema.Literals(["explore", "confirm"])),
  basis: Schema.optionalKey(Short(200)),
};

/** otherLabel：“其他（自己写）”那个选项换成别的字（检查点里是“不对，应该是…”）。 */
const otherLabel = Schema.optionalKey(Short(40));
const Single = Schema.Struct({
  kind: Schema.Literal("single"),
  ...base,
  options: Options,
  otherLabel,
});
const Multi = Schema.Struct({
  kind: Schema.Literal("multi"),
  ...base,
  options: Options,
  otherLabel,
});
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
/** 每一轮底部的自由补充（系统自带，不是 agent 的题）。 */
export const MAX_NOTE = 2000;

/** agent 一轮问什么：1–5 题，加一句开场白，以及“我现在的理解”（让客户纠错，不是进度）。 */
export const AskRound = Schema.Struct({
  /** 上一轮回答让 CONTEXT.md 变了什么、推翻了我哪个假设（第一轮写“第一轮，尚无回答”）。 */
  delta: Short(400),
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
/** 比对用的归一化：去掉标签、空白和标点，转小写。 */
export const normalizeText = (t: string): string =>
  t
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

/** 答案的存储值（JSON）里的所有文字。 */
export const stringsOf = (v: unknown): string[] =>
  typeof v === "string"
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(stringsOf)
      : v !== null && typeof v === "object"
        ? Object.values(v).flatMap(stringsOf)
        : [];

/**
 * “没有依据就不给选项”：每题必须声明 resolves 和 mode；单选/多选必须是 confirm，且 basis 要逐字出现在客户说过的话里
 * （corpus = 邀请说明 + 他所有的回答和补充）。探索题不能带选项。返回 agent 读得懂的问题清单。
 */
export const groundingProblems = (questions: ReadonlyArray<Question>, corpus: string): string[] => {
  const hay = normalizeText(corpus);
  return questions.flatMap((q) => {
    if (q.resolves === undefined || q.mode === undefined)
      return [
        `题 ${q.id}：必须写 resolves（这题消除哪处“本来得编”的地方）和 mode（explore | confirm）`,
      ];
    const choice = q.kind === "single" || q.kind === "multi";
    if (choice && q.mode === "explore")
      return [
        `题 ${q.id}：explore 不能给选项——你对这块没有依据时，先用开放题（text/long）听客户自己说`,
      ];
    if (q.mode === "confirm") {
      const b = normalizeText(q.basis ?? "");
      if (b.length < 4) return [`题 ${q.id}：confirm 必须在 basis 里引用客户的原话（至少 4 个字）`];
      if (!hay.includes(b))
        return [`题 ${q.id}：basis「${q.basis}」没有在客户说过的话里找到——必须逐字引用他的原话`];
    }
    if (choice && q.mode !== "confirm") return [`题 ${q.id}：选项题必须是 confirm`];
    return [];
  });
};

export const parseAskRound = (
  input: unknown,
  usedIds: ReadonlySet<string>,
  corpus: string | null = null,
): { ok: true; round: AskRound } | { ok: false; error: string } => {
  const r = decodeAsk(input);
  if (r._tag !== "Success")
    return {
      ok: false,
      error: String(r.failure)
        .replace(/^SchemaError\(/, "")
        .slice(0, 900),
    };
  // 系统自己会加“其他（自己写）”：agent 写的“其他”类选项去掉，免得客户看到两个
  const questions = r.success.questions.map((q) =>
    q.kind === "single" || q.kind === "multi"
      ? { ...q, options: q.options.filter((o) => !/^其他([（(：:，,\s].*)?$/.test(o.label.trim())) }
      : q,
  );
  const short = questions.find(
    (q) => (q.kind === "single" || q.kind === "multi") && q.options.length < 2,
  );
  if (short)
    return {
      ok: false,
      error: `题 ${short.id}：去掉“其他”之后选项不足 2 个（系统会自动给每道单选/多选加一个“其他（自己写）”，你不用写）`,
    };
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q.id)) return { ok: false, error: `题目 id 重复：${q.id}` };
    if (usedIds.has(q.id)) return { ok: false, error: `题目 id ${q.id} 以前用过，换一个新的` };
    seen.add(q.id);
  }
  if (corpus !== null) {
    const problems = groundingProblems(questions, corpus);
    if (problems.length > 0) return { ok: false, error: problems.join("；") };
  }
  return { ok: true, round: { ...r.success, questions } };
};

// ---- 检查点 ----

/**
 * 检查点：每满一个阶段，agent 把“我这一阶段听到的要点”交给客户逐条确认。要点是它的工具入参，
 * 题目由系统生成（agent 不能在检查点里夹带别的题）：每条一道选填的单选——对 / 不确定 / 不对，应该是…（客户自己写）。
 */
export const CheckpointInput = Schema.Struct({
  intro: Short(400),
  items: Schema.Array(Schema.Struct({ topic: Short(40), claim: Short(250) })).check(
    Schema.isMinLength(3),
    Schema.isMaxLength(14),
  ),
});
export type CheckpointInput = typeof CheckpointInput.Type;

const decodeCheckpoint = Schema.decodeUnknownResult(CheckpointInput, { onExcessProperty: "error" });

export const parseCheckpoint = (
  input: unknown,
  stage: number,
): { ok: true; intro: string; questions: Question[] } | { ok: false; error: string } => {
  const r = decodeCheckpoint(input);
  if (r._tag !== "Success")
    return {
      ok: false,
      error: String(r.failure)
        .replace(/^SchemaError\(/, "")
        .slice(0, 900),
    };
  return {
    ok: true,
    intro: r.success.intro,
    questions: r.success.items.map((it, i): Question => ({
      kind: "single",
      id: `cp${stage + 1}-${i + 1}`,
      title: `${it.topic}：${it.claim}`,
      why: "我这一阶段听到的是这样——对不对？",
      optional: true,
      otherLabel: "不对，应该是…",
      options: [{ label: "对" }, { label: "不确定" }],
    })),
  };
};

// ---- 答案 ----

/** 答案的值：文字/数字/选项（单选一个、多选多个）/ 链接们 / 上传文件的路径们。富文本存的是净化后的 HTML。 */
export type Value = string | number | ReadonlyArray<string>;

/**
 * 单选/多选的“其他（自己写）”：系统给每道单选、多选题自动加一个，agent 不用也不能自己写“其他”选项
 * （parseAskRound 会把它们去掉）。自己写的答案存成 `其他：<文字>`——前缀是保留的，所以和 agent 的选项不会混。
 */
export const OTHER_PREFIX = "其他：";
export const MAX_OTHER = 200;
export const isOther = (v: string): boolean => v.startsWith(OTHER_PREFIX);
export const otherText = (v: string): string => v.slice(OTHER_PREFIX.length).trim();

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
      if (q.options.some((o) => o.label === raw)) return good(raw);
      if (isOther(raw)) {
        const t = otherText(raw);
        if (t === "") return bad("请写下你的答案");
        return t.length > MAX_OTHER ? bad(`最多 ${MAX_OTHER} 个字`) : good(OTHER_PREFIX + t);
      }
      return bad("不是这道题的选项");
    }
    case "multi": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string"))
        return bad("多选的答案是一组选项");
      const picked: string[] = [];
      let others = 0;
      for (const p of new Set(raw as string[])) {
        if (q.options.some((o) => o.label === p)) picked.push(p);
        else if (isOther(p)) {
          const t = otherText(p);
          if (t === "") return bad("请写下你补充的选项");
          if (t.length > MAX_OTHER) return bad(`最多 ${MAX_OTHER} 个字`);
          others += 1;
          picked.push(OTHER_PREFIX + t);
        } else return bad("有不是这道题选项的值");
      }
      if (others > 1) return bad("自己补充的只能写一条");
      return picked.length === 0 ? bad("至少选一个") : good(picked);
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
