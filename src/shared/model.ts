/**
 * Site model：开发者访谈的机器交付物。它只装“决定”——有哪些页面（BSP）、每页干什么、
 * 有哪些内容类型/字段/路由、哪些词表、什么语言、表单收到哪——不装版式、种子数据、模板、每页条数。
 *
 * 同一份 Effect Schema 同时是：agent 工具 `propose_model` 的入参（JSON Schema）、
 * 交付物校验（decode）、以及下游 sketch / zeroY 编译器的输入类型。
 *
 * 结构由 Schema 判；Schema 表达不了的跨字段规则（路由和页面要对上、引用要存在、intake 字段要能填）
 * 由下面命名的 gate 判。两者都在 `finish_interview` 里再跑一次。
 */
import { Schema } from "effect";

/** 类型名：zeroY / WordPress 的注册规则（小写开头，≤20）。 */
const TypeName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/), Schema.isMaxLength(20));
/** 词表名 / ref 指向的类型名：同一个命名空间规则。 */
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/), Schema.isMaxLength(32));
const FieldName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/),
  Schema.isMaxLength(48),
);
const Text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
/** 路由：以 / 开头，允许 :param；没有空格。 */
const Path = Schema.String.check(
  Schema.isPattern(/^\/(?:[A-Za-z0-9._:-]+\/?)*$/),
  Schema.isMaxLength(200),
);
const TermId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  Schema.isMaxLength(40),
);
const Email = Schema.String.check(
  Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  Schema.isMaxLength(120),
);

const Field = Schema.Struct({
  name: FieldName,
  label: Text(80),
  /** text / number / bool / choice / term / ref / media / list / date。 */
  kind: Schema.Literals([
    "text",
    "number",
    "bool",
    "choice",
    "term",
    "ref",
    "media",
    "list",
    "date",
  ]),
  required: Schema.optionalKey(Schema.Boolean),
  localized: Schema.optionalKey(Schema.Literals(["shared", "translated", "derived"])),
  /** term / media / ref 可多选。 */
  multiple: Schema.optionalKey(Schema.Boolean),
  /** choice 的选项。 */
  options: Schema.optionalKey(
    Schema.Array(Text(80)).check(Schema.isMinLength(2), Schema.isMaxLength(20)),
  ),
  /** term 引用的词表名。 */
  vocabulary: Schema.optionalKey(Name),
  /** ref 指向的内容类型名。 */
  to: Schema.optionalKey(Name),
  /** media 的类型。 */
  of: Schema.optionalKey(Schema.Literals(["image", "file"])),
  /** list 的列（参数行、规格表）。 */
  columns: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: FieldName, label: Text(40) })).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(6),
    ),
  ),
  note: Schema.optionalKey(Text(200)),
});

const Routes = Schema.Struct({
  collection: Schema.optionalKey(Path),
  record: Schema.optionalKey(Path),
  single: Schema.optionalKey(Path),
  /** 只给后台/表单提交，没有地址。 */
  internal: Schema.optionalKey(Schema.Boolean),
});

const Intake = Schema.Struct({
  /** 表单收哪些字段（必须是这个类型的字段，且是表单填得进去的）。 */
  fields: Schema.Array(FieldName).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  notify: Schema.Array(Email).check(Schema.isMaxLength(5)),
});

const TypeDef = Schema.Struct({
  name: TypeName,
  title: Text(80),
  routes: Routes,
  fields: Schema.Array(Field).check(Schema.isMaxLength(40)),
  intake: Schema.optionalKey(Intake),
});

const Vocabulary = Schema.Struct({
  name: Name,
  title: Text(80),
  /** 词条；没有就留空，草图/后台再补。 */
  terms: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: TermId, label: Text(80) })).check(Schema.isMaxLength(200)),
  ),
});

const Page = Schema.Struct({
  path: Path,
  title: Text(80),
  /** 一句话职责：这一页对访客做什么。 */
  job: Text(160),
  kind: Schema.Literals(["single", "collection", "record", "utility", "form"]),
  /** collection / record / single / form 指向的内容类型；utility 可以写数据来源（如下载页读 product 的 media），不写就是静态页。 */
  type: Schema.optionalKey(TypeName),
});

export const Model = Schema.Struct({
  format: Schema.Literal(1),
  code: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,38}$/)),
  /** 一句话：这个站为谁、解决什么、访客最后做什么。 */
  summary: Text(400),
  locales: Schema.Struct({
    default: Text(20),
    enabled: Schema.Array(Text(20)).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  }),
  types: Schema.Array(TypeDef).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
  vocabularies: Schema.Array(Vocabulary).check(Schema.isMaxLength(20)),
  pages: Schema.Array(Page).check(Schema.isMinLength(1), Schema.isMaxLength(40)),
});
export type Model = typeof Model.Type;

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));
const decodeModel = Schema.decodeUnknownResult(Model, { onExcessProperty: "error" });

/** JSON 文本 → Model（只解码，不跑 gate）。失败时 errors 是可以直接退给 agent 的话。 */
export const decodeModelText = (
  text: string,
):
  | { readonly ok: true; readonly model: Model }
  | { readonly ok: false; readonly errors: string[] } => {
  const parsed = decodeJson(text);
  if (parsed._tag !== "Success") return { ok: false, errors: ["不是合法的 JSON"] };
  const decoded = decodeModel(parsed.success);
  if (decoded._tag !== "Success")
    return {
      ok: false,
      errors: [
        String(decoded.failure)
          .replace(/^SchemaError\(/, "")
          .slice(0, 1200),
      ],
    };
  return { ok: true, model: decoded.success };
};

const fieldKind = (f: Model["types"][number]["fields"][number]): string => f.kind;

/**
 * 命名的 gate：每个只回答一件事，错误里带 index / path，agent 能直接改。
 * 新增一条 gate = 在这里加一个函数 + 在 MODEL_GATES 里登记 + 配测试。
 */
export const GATES: Readonly<Record<string, (m: Model) => ReadonlyArray<string>>> = {
  "pages-unique": (m) => {
    const seen = new Map<string, number>();
    const out: string[] = [];
    m.pages.forEach((p, i) => {
      const first = seen.get(p.path);
      if (first === undefined) seen.set(p.path, i);
      else out.push(`pages[${i}] 和 pages[${first}] 的路径重复：${p.path}`);
    });
    return out;
  },

  "pages-have-jobs": (m) =>
    m.pages.flatMap((p, i) =>
      p.job.trim() === "" ? [`pages[${i}]（${p.path}）的 job 是空的`] : [],
    ),

  "routes-match-pages": (m) => {
    const out: string[] = [];
    const pageByPath = new Map(m.pages.map((p) => [p.path, p]));
    const typeByName = new Map(m.types.map((t) => [t.name, t]));

    m.types.forEach((t, ti) => {
      const r = t.routes;
      const has = [r.collection, r.record, r.single, r.internal === true].filter(Boolean).length;
      const at = `types[${ti}]（${t.name}）`;
      if (has === 0) out.push(`${at} 没有路由：collection / record / single / internal 至少一个`);
      if (r.internal === true && (r.collection || r.record || r.single))
        out.push(`${at} 的 internal 不能和 collection / record / single 同时存在`);
      if (r.single && (r.collection || r.record))
        out.push(`${at} 的 single 不能和 collection / record 同时存在`);

      const pairs = [
        ["collection", r.collection],
        ["record", r.record],
        ["single", r.single],
      ] as const;
      for (const [kind, path] of pairs) {
        if (!path) continue;
        const page = pageByPath.get(path);
        if (!page) {
          out.push(`${at} 的路由 ${path} 没有对应的 page`);
          continue;
        }
        if (page.kind !== kind)
          out.push(`${at} 的路由 ${path} 对应的 page 是 ${page.kind}，应该是 ${kind}`);
        if (page.type !== t.name)
          out.push(
            `${at} 的路由 ${path} 对应的 page.type 是 ${page.type ?? "空"}，应该是 ${t.name}`,
          );
      }
    });

    m.pages.forEach((p, pi) => {
      const at = `pages[${pi}]（${p.path}）`;
      if (p.kind === "collection" || p.kind === "record") {
        if (!p.type) {
          out.push(`${at} 是 ${p.kind}，必须写 type`);
          return;
        }
        const t = typeByName.get(p.type);
        if (!t) {
          out.push(`${at} 的 type ${p.type} 不存在`);
          return;
        }
        const route = p.kind === "collection" ? t.routes.collection : t.routes.record;
        if (route !== p.path)
          out.push(`${at} 和 types（${p.type}）的 ${p.kind} 路由 ${route ?? "（没写）"} 对不上`);
        if (p.path.includes(":") !== (p.kind === "record"))
          out.push(`${at} 的路径里 ${p.kind === "record" ? "必须" : "不能"}有 :参数`);
      }
      if (p.kind === "single") {
        if (p.path.includes(":")) out.push(`${at} 是单页，路径里不能有 :参数`);
        if (p.type) {
          const t = typeByName.get(p.type);
          if (!t) out.push(`${at} 的 type ${p.type} 不存在`);
          else if (t.routes.single !== p.path)
            out.push(
              `${at} 和 types（${p.type}）的 single 路由 ${t.routes.single ?? "（没写）"} 对不上`,
            );
        }
      }
      if (p.kind === "utility" && p.type && !typeByName.has(p.type))
        out.push(`${at} 的 type ${p.type} 不存在`);
      if (p.kind === "form") {
        if (!p.type) out.push(`${at} 是表单页，必须写 type`);
        else {
          const t = typeByName.get(p.type);
          if (!t) out.push(`${at} 的 type ${p.type} 不存在`);
          else if (t.routes.internal !== true)
            out.push(`${at} 的 type ${p.type} 不是 internal（表单提交的类型）`);
          else if (!t.intake) out.push(`${at} 的 type ${p.type} 没有 intake`);
        }
        if (p.path.includes(":")) out.push(`${at} 是表单页，路径里不能有 :参数`);
      }
    });

    return out;
  },

  "refs-exist": (m) => {
    const out: string[] = [];
    const types = new Set<string>();
    const vocabs = new Set<string>();
    const typeNames = new Set(m.types.map((t) => t.name));
    const vocabNames = new Set(m.vocabularies.map((v) => v.name));

    if (!m.locales.enabled.includes(m.locales.default))
      out.push(`locales.default「${m.locales.default}」不在 enabled 里`);

    m.types.forEach((t, ti) => {
      const at = `types[${ti}]（${t.name}）`;
      if (types.has(t.name)) out.push(`${at} 的类型名重复`);
      types.add(t.name);

      const fieldNames = new Set<string>();
      t.fields.forEach((f, fi) => {
        const fat = `${at} fields[${fi}]（${f.name}）`;
        if (fieldNames.has(f.name)) out.push(`${fat} 的字段名重复`);
        fieldNames.add(f.name);
        const kind = fieldKind(f);
        if (kind === "choice" && (!f.options || f.options.length < 2))
          out.push(`${fat}：choice 需要至少 2 个 options`);
        if (kind === "term") {
          if (!f.vocabulary) out.push(`${fat}：term 需要 vocabulary`);
          else if (!vocabNames.has(f.vocabulary))
            out.push(`${fat}：vocabulary「${f.vocabulary}」不存在`);
        }
        if (kind === "ref") {
          if (!f.to) out.push(`${fat}：ref 需要 to`);
          else if (!typeNames.has(f.to)) out.push(`${fat}：ref 指向的「${f.to}」不存在`);
        }
        if (kind === "media" && !f.of) out.push(`${fat}：media 需要 of（image / file）`);
        if (kind === "list" && (!f.columns || f.columns.length === 0))
          out.push(`${fat}：list 需要 columns`);
      });

      if (t.intake) {
        if (t.routes.internal !== true) out.push(`${at} 有 intake，但路由不是 internal`);
        if (!m.pages.some((p) => p.kind === "form" && p.type === t.name))
          out.push(`${at} 有 intake，但没有一个 kind=form 的 page 指向它`);
        for (const name of t.intake.fields) {
          const f = t.fields.find((x) => x.name === name);
          if (!f) out.push(`${at} 的 intake 字段「${name}」不存在`);
          else if (!["text", "number", "bool", "choice", "media"].includes(f.kind))
            out.push(`${at} 的 intake 字段「${name}」是 ${f.kind}，表单收不了`);
        }
        for (const email of t.intake.notify)
          if (/(^|@)(example\.(com|org|net)|test\.(com|org)|yourdomain\.)/i.test(email))
            out.push(`${at} 的 intake.notify 是占位邮箱「${email}」：留空，或换成客户给的地址`);
      }
    });

    m.vocabularies.forEach((v, vi) => {
      const at = `vocabularies[${vi}]（${v.name}）`;
      if (vocabs.has(v.name)) out.push(`${at} 的词表名重复`);
      vocabs.add(v.name);
      const ids = new Set<string>();
      (v.terms ?? []).forEach((term, ti) => {
        if (ids.has(term.id)) out.push(`${at} terms[${ti}] 的 id「${term.id}」重复`);
        ids.add(term.id);
      });
    });

    return out;
  },

  "types-have-fields": (m) =>
    m.types.flatMap((t, i) => (t.fields.length === 0 ? [`types[${i}]（${t.name}）没有字段`] : [])),
};

/** 登记顺序就是 `propose_model` / `finish_interview` 的报错顺序。 */
export const MODEL_GATES = [
  "pages-unique",
  "pages-have-jobs",
  "routes-match-pages",
  "refs-exist",
  "types-have-fields",
] as const;
export type ModelGate = (typeof MODEL_GATES)[number];

/** 跑全部 gate；`checkDeliverable` 只跑预设里点名的那几条。 */
export const checkModel = (m: Model): ReadonlyArray<string> =>
  MODEL_GATES.flatMap((name) => GATES[name]!(m));
