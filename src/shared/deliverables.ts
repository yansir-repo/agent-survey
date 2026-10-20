/**
 * 交付物的登记处：预设里写 `{ path, format, schema?, gates? }`，这里把名字解析成真正的校验。
 *
 *   markdown → 只判非空（散文的好坏由独立检查者 / 人判，不在这里）
 *   json     → 用登记的 Effect Schema 解码，再跑预设点名的 gate
 *
 * 名字必须在这里登记；预设里写一个不存在的 schema / gate 是配置错误，会明确报出来。
 * schema 是模型眼前的工具入参（interviewer.ts 的 propose_model / record_facts），也是这里的门；
 * 一份 Effect Schema 两处用，不会漂移。
 */
import type { Schema } from "effect";
import { ClientFacts, FACTS_GATES, GATES as FACTS_GATE_FNS, decodeFactsText } from "./facts.ts";
import { GATES as MODEL_GATE_FNS, MODEL_GATES, Model, decodeModelText } from "./model.ts";

export type Deliverable = {
  /** 工作区里的路径，例如 /model.json。 */
  readonly path: string;
  readonly format: "markdown" | "json";
  /** JSON 交付物用哪个 schema（登记在 SCHEMAS 里）。 */
  readonly schema?: string;
  /** 要跑哪些 gate；不写 = schema 的默认 gate 全跑。 */
  readonly gates?: ReadonlyArray<string>;
  /** `result` 的 context 给哪份；一场访谈最多一份。 */
  readonly primary?: boolean;
};

export type Checked =
  | { readonly ok: true; readonly text: string; readonly value?: unknown }
  | { readonly ok: false; readonly error: string };

type Decoded =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };
type Gate = (value: unknown) => ReadonlyArray<string>;
type SchemaDef = {
  readonly schema: Schema.Top & Schema.Decoder<unknown>;
  readonly decode: (text: string) => Decoded;
  readonly defaultGates: ReadonlyArray<string>;
  readonly gates: Readonly<Record<string, Gate>>;
};

/** 把某个类型的 gate 表擦成统一的 `unknown` 入口；真正的类型在各自的模块里。 */
const lift = <T>(
  gates: Readonly<Record<string, (value: T) => ReadonlyArray<string>>>,
): Readonly<Record<string, Gate>> =>
  Object.fromEntries(
    Object.entries(gates).map(([name, gate]) => [name, (value: unknown) => gate(value as T)]),
  );

const siteModel = {
  schema: Model,
  decode: (text: string): Decoded => {
    const r = decodeModelText(text);
    return r.ok ? { ok: true, value: r.model } : r;
  },
  defaultGates: MODEL_GATES,
  gates: lift(MODEL_GATE_FNS),
} satisfies SchemaDef;

const clientFacts = {
  schema: ClientFacts,
  decode: (text: string): Decoded => {
    const r = decodeFactsText(text);
    return r.ok ? { ok: true, value: r.facts } : r;
  },
  defaultGates: FACTS_GATES,
  gates: lift(FACTS_GATE_FNS),
} satisfies SchemaDef;

/** 加一个 JSON 交付物 = 在这里加一项 + 一个 schema 模块 + 测试。 */
export const SCHEMAS: Readonly<Record<string, SchemaDef>> = {
  "site-model": siteModel,
  "client-facts": clientFacts,
};

const runGates = (
  value: unknown,
  names: ReadonlyArray<string>,
  gates: Readonly<Record<string, Gate>>,
): ReadonlyArray<string> =>
  names.flatMap((name) => {
    const gate = gates[name];
    return gate ? gate(value) : [`没有这个 gate：${name}`];
  });

/** 读到的文本 → 合格的交付物（JSON 返回规范化后的文本）。错误是能直接退给 agent 的话。 */
export const checkDeliverable = (d: Deliverable, text: string): Checked => {
  if (text.trim() === "") return { ok: false, error: `${d.path} 是空的` };
  if (d.format === "markdown") return { ok: true, text };

  if (!d.schema) return { ok: false, error: `${d.path} 是 JSON，但预设没有声明 schema` };
  const def = SCHEMAS[d.schema];
  if (!def) return { ok: false, error: `没有这个 schema：${d.schema}` };

  const decoded = def.decode(text);
  if (!decoded.ok) return { ok: false, error: decoded.errors.join("\n") };

  const errors = runGates(decoded.value, d.gates ?? def.defaultGates, def.gates);
  if (errors.length > 0) return { ok: false, error: errors.join("\n") };

  return { ok: true, text: JSON.stringify(decoded.value, null, 2), value: decoded.value };
};
