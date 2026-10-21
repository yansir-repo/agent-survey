/**
 * 问题的词表：agent 每道题自己决定交互方式，但方式是一个**封闭集合**——它能问什么，由这里一处决定。
 * 同一份 Schema 同时是：TS 类型、agent 的工具入参（JSON Schema）、客户端渲染的依据。
 *
 *   Question = id × title × why × 方式（single | multi | number | text | long | rich | link | image | file）
 *   Answer   = 与方式对应的值；受访者可以不答（稍后再答），所以“没有答案”是一等状态，不是错误。
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
  /** 问题本身，受访者读到的那句话。 */
  title: Short(300),
  /** 为什么问：一句话说明这题的用途（受访者愿意回答的前提）。 */
  why: Short(300),
  /**
   * 选填：受访者可以不写，也不用“稍后再答”——空着就是空着，不会被补问。要写“可留空”就用这个，别写进题目里。
   * （“稍后再答”是另一回事：那是受访者想答但现在答不了，系统会补问。）
   */
  optional: Schema.optionalKey(Schema.Boolean),
  /**
   * 出题者的自检（agent 发起的题必填，系统自己生成的检查点题没有）：
   *   resolves 这题消除的是哪一处“不问我就得编”的地方；
   *   mode     explore = 开放题，听受访者自己说；
   *            guess   = 选项是我猜的（没有依据也行）：猜得越像越好，都不符合时受访者会自己写；
   *            confirm = 选项来自受访者说过的话，在验证一个假设；
   *   basis    confirm 必填：受访者（或邀请说明里）的原话，逐字——系统会在他说过的话里找它。
   */
  resolves: Schema.optionalKey(Short(200)),
  mode: Schema.optionalKey(Schema.Literals(["explore", "guess", "confirm"])),
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

export const MAX_QUESTIONS_PER_ROUND = 8;
/** 一轮最多几道“小作文”题（long / rich）：受访者的力气是有限的，选择题可以多，作文题不能多。 */
export const MAX_ESSAYS_PER_ROUND = 1;
/** 每一轮底部的自由补充（系统自带，不是 agent 的题）。 */
export const MAX_NOTE = 2000;

/** agent 一轮问什么：1–8 题（其中最多 1 道作文题），加一句开场白，以及“我现在的理解”（让受访者纠错，不是进度）。 */
export const AskRound = Schema.Struct({
  /** 上一轮回答让 NOTES.md 变了什么、推翻了我哪个假设（第一轮写“第一轮，尚无回答”）。 */
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
/** 空字符串 = 没写：模型常把不用的选填字段（hint、placeholder…）填成 ""，这不是错，等同于没有这个键。 */
export const withoutBlanks = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(withoutBlanks)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== "")
            .map(([k, x]) => [k, withoutBlanks(x)]),
        )
      : v;

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
        : typeof v === "number"
          ? [String(v)]
          : [];

/**
 * 一轮的形状（不看内容，只数）：一道题只问一件事（标题里不能有两个问号）；作文题（long / rich）一轮最多 MAX_ESSAYS_PER_ROUND 道。
 */
export const shapeProblems = (questions: ReadonlyArray<Question>): string[] => {
  const compound = questions
    .filter((q) => (q.title.match(/[？?]/g) ?? []).length >= 2)
    .map((q) => `题 ${q.id}：一道题里有多个问号——一题只问一件事，拆成几道（能选的做成选择题）`);
  const essays = questions.filter((q) => q.kind === "long" || q.kind === "rich");
  return essays.length > MAX_ESSAYS_PER_ROUND
    ? [
        ...compound,
        `这一轮有 ${essays.length} 道作文题（${essays.map((q) => q.id).join("、")}），最多 ${MAX_ESSAYS_PER_ROUND} 道：其余改成选择题（猜几个可能的选项，受访者都不符合时会自己写），或留到下一轮`,
      ]
    : compound;
};

/**
 * 选项题要声明依据：每题必须有 resolves 和 mode；单选/多选必须是 guess（选项是你猜的）或 confirm（来自受访者的话）；
 * confirm 的 basis 要逐字出现在受访者说过的话里（corpus = 邀请说明 + 他所有的回答和补充）。explore 是开放题，不带选项。
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
        `题 ${q.id}：explore 是开放题，不能带选项——要给选项就用 guess（你猜的）或 confirm（来自受访者的话）`,
      ];
    if (q.mode === "confirm") {
      // 一条 basis 可以引用几处原话（用 …、/、；、| 或换行隔开）：每一段都要在他的话里找到，且至少有一段不短于 4 个字
      const parts = (q.basis ?? "")
        .split(/\.{2,}|…|[/|；;\n]/)
        .map(normalizeText)
        .filter((x) => x.length >= 2);
      if (!parts.some((x) => x.length >= 4))
        return [`题 ${q.id}：confirm 必须在 basis 里引用受访者的原话（至少 4 个字）`];
      const missing = parts.find((x) => !hay.includes(x));
      if (missing !== undefined)
        return [
          `题 ${q.id}：basis 里的「${missing}」没有在受访者说过的话里找到——逐字抄他的原话（不要改写、概括；可以用 … 隔开几处原话）`,
        ];
    }
    return [];
  });
};

export const parseAskRound = (
  input: unknown,
  usedIds: ReadonlySet<string>,
  corpus: string | null = null,
): { ok: true; round: AskRound } | { ok: false; error: string } => {
  const r = decodeAsk(withoutBlanks(input));
  if (r._tag !== "Success")
    return {
      ok: false,
      error: String(r.failure)
        .replace(/^SchemaError\(/, "")
        .slice(0, 900),
    };
  // 系统自己会加“其他（自己写）”：agent 写的“其他”类选项去掉，免得受访者看到两个
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
  const shape = shapeProblems(questions);
  if (shape.length > 0) return { ok: false, error: shape.join("；") };
  if (corpus !== null) {
    const problems = groundingProblems(questions, corpus);
    if (problems.length > 0) return { ok: false, error: problems.join("；") };
  }
  return { ok: true, round: { ...r.success, questions } };
};

// ---- 检查点 ----

/**
 * 检查点：每满一个阶段，agent 把“我这一阶段听到的要点”交给受访者逐条确认。要点是它的工具入参，
 * 题目由系统生成（agent 不能在检查点里夹带别的题）：每条一道选填的单选——对 / 不确定 / 不对，应该是…（受访者自己写）。
 */
export const MIN_CLAIMS = 3;
export const MAX_CLAIMS = 8;
/** 要点是选项的说明行（hint ≤ 120 字）。 */
export const CLAIM_MAX = 120;
export const CheckpointInput = Schema.Struct({
  intro: Short(400),
  items: Schema.Array(Schema.Struct({ topic: Short(40), claim: Short(CLAIM_MAX) })).check(
    Schema.isMinLength(MIN_CLAIMS),
    Schema.isMaxLength(MAX_CLAIMS),
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
    // 一道多选：勾出“不对的”，什么都不勾 = 全都对。比逐条点“对”轻得多（实测：12 条逐条确认，受访者只点了 1 条）。
    questions: [
      {
        kind: "multi",
        id: `cp${stage + 1}`,
        title: "下面这几条里，有哪几条不对？",
        why: "这是我这一阶段听到的。没有不对的就不用勾，直接提交。",
        optional: true,
        otherLabel: "还有别的不对 / 想补充（自己写）",
        options: r.success.items.map((it) => ({ label: it.topic, hint: it.claim })),
      },
    ],
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
