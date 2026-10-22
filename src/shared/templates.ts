/**
 * template：可复用的访谈模板（旧称 profile）。一份模板 = 目标描述（goal，给 agent 看）+ 验收条款（criteria，结束前逐条验证）
 * + 一些可选的默认值（受访者说明、开场说明、节奏、能力、语言）。数据在仓库根的 `templates/`，那里是引擎里唯一允许懂领域的地方。
 *
 * 创建访谈时，模板和这次的覆盖合成一份**快照**（`Spec` + goal 文本）存进访谈：之后改模板不影响进行中的访谈。
 * 节奏和能力**默认不设限**：不写就是不限、全开；字段留着，以后随时能收紧。
 */
import { Schema } from "effect";
import { TEMPLATE_DATA } from "../../templates/index.ts";
import { Question } from "./questions.ts";

export type TemplateData = {
  readonly version: number;
  readonly title: string;
  /** 目标描述：这场访谈要弄清什么（markdown）。 */
  readonly goal: string;
  /** 验收条款：每条一句能答“是 / 否”的陈述。没有 = 不验证。 */
  readonly criteria: ReadonlyArray<string>;
  /** 受访者说明：外行还是专家，决定减负门的松紧。 */
  readonly respondent?: string;
  /** 开场说明：给受访者看的，谁在问、为什么问、大约多久。 */
  readonly intro?: string;
  readonly pace?: { readonly maxRounds?: number; readonly perRound?: number };
  readonly capabilities?: {
    readonly web?: boolean;
    readonly search?: boolean;
    readonly uploads?: boolean;
  };
  readonly language?: string;
};

export const TEMPLATES: Readonly<Record<string, TemplateData>> = TEMPLATE_DATA;
export const DEFAULT_TEMPLATE = "blank";
export const MAX_GOAL = 12_000;
export const MAX_CRITERIA = 12;
export const MAX_CRITERION = 240;
export const DEFAULT_LANGUAGE = "中文";

/** 创建访谈时存下的快照：除了 goal 文本以外的一切。 */
export type Spec = {
  readonly template: { readonly name: string; readonly version: number };
  readonly criteria: ReadonlyArray<string>;
  readonly respondent: string;
  readonly intro: string;
  /** null = 不设限。 */
  readonly pace: { readonly maxRounds: number | null; readonly perRound: number | null };
  readonly capabilities: {
    readonly web: boolean;
    readonly search: boolean;
    readonly uploads: boolean;
  };
  readonly language: string;
  /** 完成回调地址；空 = 不回调。 */
  readonly notify: string;
  /**
   * 固定题：提问方指定、一定会问的题（例如要收的账号密码），加在第一轮 agent 题的后面，id 以 `fx-` 开头。
   * agent 不能用 `fx-` 开头的 id，也看得到它们已经问了。
   */
  readonly fixed: ReadonlyArray<Question>;
};

export const FIXED_PREFIX = "fx-";
export const MAX_FIXED = 8;
const decodeQuestion = Schema.decodeUnknownResult(Question, { onExcessProperty: "error" });

export const DEFAULT_SPEC: Spec = {
  template: { name: DEFAULT_TEMPLATE, version: 1 },
  criteria: [],
  respondent: "",
  intro: "",
  pace: { maxRounds: null, perRound: null },
  capabilities: { web: true, search: true, uploads: true },
  language: DEFAULT_LANGUAGE,
  notify: "",
  fixed: [],
};

const rec = (x: unknown): Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const posInt = (x: unknown): number | null =>
  typeof x === "number" && Number.isInteger(x) && x > 0 ? x : null;

/** 把任意 JSON 收成快照：缺的字段用默认（老访谈存的快照读出来也走这里）。 */
export const specOf = (raw: unknown): Spec => {
  const o = rec(raw);
  const d = DEFAULT_SPEC;
  const t = rec(o["template"]);
  const pace = rec(o["pace"]);
  const cap = rec(o["capabilities"]);
  return {
    template: {
      name: typeof t["name"] === "string" ? t["name"] : d.template.name,
      version: typeof t["version"] === "number" ? t["version"] : d.template.version,
    },
    criteria: Array.isArray(o["criteria"])
      ? o["criteria"].filter((c): c is string => typeof c === "string")
      : d.criteria,
    respondent: typeof o["respondent"] === "string" ? o["respondent"] : d.respondent,
    intro: typeof o["intro"] === "string" ? o["intro"] : d.intro,
    pace: { maxRounds: posInt(pace["maxRounds"]), perRound: posInt(pace["perRound"]) },
    capabilities: {
      web: cap["web"] !== false,
      search: cap["search"] !== false,
      uploads: cap["uploads"] !== false,
    },
    language:
      typeof o["language"] === "string" && o["language"] !== "" ? o["language"] : d.language,
    notify: typeof o["notify"] === "string" ? o["notify"] : d.notify,
    fixed: Array.isArray(o["fixed"])
      ? o["fixed"].flatMap((x) => {
          const r = decodeQuestion(x);
          return r._tag === "Success" ? [r.success] : [];
        })
      : d.fixed,
  };
};

export type Resolved =
  | {
      readonly ok: true;
      /** 存进登记表的说明：模板名，有覆盖 / 补充时标出来。 */
      readonly label: string;
      readonly goal: string;
      readonly spec: Spec;
    }
  | { readonly ok: false; readonly error: string };

const str = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

/**
 * 发链接时的用法：选一个模板（默认 `DEFAULT_TEMPLATE`）；`goal` 整段覆盖目标；`append` 在后面追加；
 * `criteria` / `respondent` / `intro` / `pace` / `capabilities` / `language` 覆盖模板里对应的默认值；`notify` 是完成回调地址。
 * 输入是请求体里的原样 JSON：这里负责把它收成合格的快照，或者给一句能直接退给调用方的话。
 */
export const resolveTemplate = (body: Readonly<Record<string, unknown>>): Resolved => {
  const name = str(body["template"]) || DEFAULT_TEMPLATE;
  const tpl = TEMPLATES[name];
  const override = str(body["goal"]);
  if (override === "" && !tpl)
    return {
      ok: false,
      error: `没有这个模板：${name}（有：${Object.keys(TEMPLATES).join("、")}）`,
    };

  const base = override !== "" ? override : (tpl?.goal ?? "");
  const append = str(body["append"]);
  const goal = append === "" ? base : `${base}\n\n## 这次的补充\n\n${append}`;
  if (goal.length > MAX_GOAL)
    return { ok: false, error: `目标描述太长了（最多 ${MAX_GOAL} 个字）` };

  let criteria: ReadonlyArray<string> = tpl?.criteria ?? [];
  if (body["criteria"] !== undefined) {
    const given = body["criteria"];
    if (!Array.isArray(given) || given.some((c) => typeof c !== "string"))
      return { ok: false, error: "criteria 要是一个字符串数组（每条一句能答“是 / 否”的陈述）" };
    criteria = (given as string[]).map((c) => c.trim()).filter((c) => c !== "");
  }
  if (criteria.length > MAX_CRITERIA)
    return { ok: false, error: `验收条款最多 ${MAX_CRITERIA} 条` };
  if (criteria.some((c) => c.length > MAX_CRITERION))
    return { ok: false, error: `每条验收条款最多 ${MAX_CRITERION} 个字` };

  const paceGiven = body["pace"] !== undefined ? body["pace"] : tpl?.pace;
  const capGiven = body["capabilities"] !== undefined ? body["capabilities"] : tpl?.capabilities;
  for (const [what, v] of [
    ["pace", paceGiven],
    ["capabilities", capGiven],
  ] as const)
    if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v)))
      return { ok: false, error: `${what} 要是一个对象` };
  const pace = rec(paceGiven);
  for (const key of ["maxRounds", "perRound"])
    if (pace[key] !== undefined && posInt(pace[key]) === null)
      return { ok: false, error: `pace.${key} 要是正整数（不写 = 不设限）` };
  const cap = rec(capGiven);
  for (const key of ["web", "search", "uploads"])
    if (cap[key] !== undefined && typeof cap[key] !== "boolean")
      return { ok: false, error: `capabilities.${key} 要是 true 或 false（不写 = 开）` };

  let fixed: ReadonlyArray<Question> = [];
  if (body["fixed"] !== undefined) {
    const given = body["fixed"];
    if (!Array.isArray(given) || given.length > MAX_FIXED)
      return { ok: false, error: `fixed 要是一个题目数组（最多 ${MAX_FIXED} 题）` };
    const out: Question[] = [];
    for (const [i, raw] of given.entries()) {
      const o = rec(raw);
      const id = str(o["id"]) || `q${i + 1}`;
      const r = decodeQuestion({
        ...o,
        id: id.startsWith(FIXED_PREFIX) ? id : `${FIXED_PREFIX}${id}`,
      });
      if (r._tag === "Failure")
        return {
          ok: false,
          error: `fixed 第 ${i + 1} 题不合格：${String(r.failure).slice(0, 200)}`,
        };
      out.push(r.success);
    }
    if (new Set(out.map((x) => x.id)).size !== out.length)
      return { ok: false, error: "fixed 里有重复的 id" };
    fixed = out;
  }

  const notify = str(body["notify"]);
  if (notify !== "" && !(/^https?:\/\/\S+$/i.test(notify) && notify.length <= 500))
    return { ok: false, error: "notify 要是一个 http(s) 地址" };

  const spec = specOf({
    template: { name: tpl ? name : "custom", version: tpl?.version ?? 0 },
    criteria,
    respondent:
      body["respondent"] !== undefined ? str(body["respondent"]) : (tpl?.respondent ?? ""),
    intro: body["intro"] !== undefined ? str(body["intro"]) : (tpl?.intro ?? ""),
    pace,
    capabilities: cap,
    language: str(body["language"]) || tpl?.language || DEFAULT_LANGUAGE,
    notify,
    fixed,
  });
  return {
    ok: true,
    label: override !== "" ? `${name}（整段覆盖）` : append !== "" ? `${name}（有补充）` : name,
    goal,
    spec,
  };
};
