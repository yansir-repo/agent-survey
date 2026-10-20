/**
 * 客户访谈的结构化事实：五类只有客户知道、而开发者访谈一定会用到的东西。
 *
 * 它和 `Model` 是两份不同的契约：
 *   ClientFacts  客户场的“事实”（现站/分类/维护/边界/参考 + 动作）
 *   Model        开发者场的“决定”（BSP/内容模型/路由/表单）
 * CONTEXT.md 始终是给人看的叙事；facts/model 是给下一场和下游的机器输入。
 *
 * 同一份 Effect Schema 同时是 record_facts 工具的入参、交付物校验、以及 --from 的输入。
 * 不知道的写 "unknown" / "不知道"；占位（example.com、待填写、TBD）由 gate 拦。
 */
import { Schema } from "effect";
import { stringsOf } from "./questions.ts";

const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const Email = Schema.String.check(
  Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  Schema.isMaxLength(120),
);
const Url = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/), Schema.isMaxLength(300));
/** 只要域名（acme.com），不要写成一句话；不知道就整条省略。 */
const Domain = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i),
  Schema.isMaxLength(253),
);
/** 数量；null = 客户不知道/没数过。 */
const Count = Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })));

const Current = Schema.Struct({
  /** 现在的网站：有没有、什么系统、谁在维护。 */
  site: Text(300),
  products: Count,
  cases: Count,
  articles: Count,
  /** 图片/视频的大致量级。 */
  media: Schema.Literals(["few", "hundreds", "thousands", "unknown"]),
  /** 资料现在散在哪（网盘、手机、旧站后台、设计手里……）。 */
  materials: Text(300),
});

const Taxonomy = Schema.Struct({
  /** 客户自己怎么分产品（用他的词，不要替他翻译）。 */
  products: Schema.Array(Text(60)).check(Schema.isMaxLength(20)),
  markets: Schema.Array(Text(60)).check(Schema.isMaxLength(20)),
  caseGroups: Schema.Array(Text(60)).check(Schema.isMaxLength(20)),
  /** 买家一般怎么找东西（按型号、按场景、按国家……）。 */
  buyerFinds: Text(300),
});

const Maintenance = Schema.Struct({
  /** 上线后谁改内容。 */
  who: Text(200),
  frequency: Schema.Literals(["rare", "monthly", "weekly", "unknown"]),
  /** 客户想自己维护的部分：文章、产品、案例、图片…… */
  selfService: Schema.Array(Text(80)).check(Schema.isMaxLength(10)),
});

const Constraints = Schema.Struct({
  /** 第一期做到哪。 */
  phaseOne: Text(300),
  /** 明确不要的东西。 */
  outOfScope: Schema.Array(Text(100)).check(Schema.isMaxLength(10)),
  domain: Schema.optionalKey(Domain),
  host: Schema.optionalKey(Text(200)),
  email: Schema.optionalKey(Email),
  /** 品牌英文名。 */
  brandEnglish: Schema.optionalKey(Text(80)),
  certifications: Schema.Array(Text(40)).check(Schema.isMaxLength(20)),
});

const Reference = Schema.Struct({
  url: Url,
  like: Schema.Boolean,
  why: Text(200),
});

const Action = Schema.Struct({
  /** 访客最后交出什么。 */
  what: Text(300),
  /** 表单字段（没有表单就空数组）。 */
  fields: Schema.Array(Text(60)).check(Schema.isMaxLength(20)),
  /** 多久、用什么方式回应。 */
  response: Text(200),
});

export const ClientFacts = Schema.Struct({
  format: Schema.Literal(1),
  /** 访谈 code；工具会补，客户不用填。 */
  code: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,38}$/))),
  current: Current,
  taxonomy: Taxonomy,
  maintenance: Maintenance,
  constraints: Constraints,
  references: Schema.Array(Reference).check(Schema.isMaxLength(6)),
  action: Action,
});
export type ClientFacts = typeof ClientFacts.Type;

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
const decodeFacts = Schema.decodeUnknownResult(ClientFacts, { onExcessProperty: "error" });

/** JSON 文本 → ClientFacts（只解码，不跑 gate）。 */
export const decodeFactsText = (
  text: string,
):
  | { readonly ok: true; readonly facts: ClientFacts }
  | { readonly ok: false; readonly errors: string[] } => {
  const parsed = decodeJson(text);
  if (parsed._tag !== "Success") return { ok: false, errors: ["不是合法的 JSON"] };
  const decoded = decodeFacts(parsed.success);
  if (decoded._tag !== "Success")
    return {
      ok: false,
      errors: [
        String(decoded.failure)
          .replace(/^SchemaError\(/, "")
          .slice(0, 1200),
      ],
    };
  return { ok: true, facts: decoded.success };
};

const PLACEHOLDER =
  /(example\.(com|org|net)|待填写|待补充|待确认填写|TODO|TBD|placeholder|yourdomain\.|xxx)/i;

export const GATES: Readonly<Record<string, (f: ClientFacts) => ReadonlyArray<string>>> = {
  /** 五类事实的关键句不能是空白（Schema 只挡空串，挡不住一个空格）。 */
  "facts-five": (f) => {
    const required: ReadonlyArray<readonly [string, string]> = [
      ["现在有什么（current.site）", f.current.site],
      ["资料散在哪（current.materials）", f.current.materials],
      ["买家怎么找（taxonomy.buyerFinds）", f.taxonomy.buyerFinds],
      ["以后谁维护（maintenance.who）", f.maintenance.who],
      ["第一期做到哪（constraints.phaseOne）", f.constraints.phaseOne],
      ["动作是什么（action.what）", f.action.what],
    ];
    return required.filter(([, value]) => value.trim() === "").map(([label]) => `${label} 是空的`);
  },

  /** 占位内容不算事实：客户没说的，留空或写“不知道”，不要填一个看起来像真的假值。 */
  "facts-no-placeholders": (f) =>
    stringsOf(f)
      .filter((s) => PLACEHOLDER.test(s))
      .map((s) => `占位内容：${s}（留空 / 写“不知道” / 问客户）`),

  /** 同一个参考站不能既喜欢又讨厌；客户说不清就合并成一条或删掉。 */
  "references-distinct": (f) => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of f.references) {
      if (seen.has(r.url)) dup.add(r.url);
      seen.add(r.url);
    }
    return [...dup].map((url) => `references 里同一个网址出现多次：${url}（合并成一条，或删掉）`);
  },
};

export const FACTS_GATES = ["facts-five", "facts-no-placeholders", "references-distinct"] as const;

/** 跑全部 gate（`checkDeliverable` 只跑预设点名的；这里是完整自检）。 */
export const checkFacts = (f: ClientFacts): ReadonlyArray<string> =>
  FACTS_GATES.flatMap((name) => GATES[name]!(f));
