/**
 * 访谈者可以用哪些模型：发链接时选（`model`），创建时存进访谈。名字是我们自己的稳定名字，
 * 来自哪个提供商、提供商那边叫什么，只在这里一处。DeepSeek 直连；其余经 AIHubMix（OpenAI 兼容的聚合接口）。
 * 线上默认只配了 DeepSeek 的密钥——要在线上用别的，得先给 Worker 配 AIHUBMIX_API_KEY。
 */
export type ModelSpec = {
  readonly provider: "deepseek" | "aihubmix";
  /** 提供商那边的模型 id。 */
  readonly id: string;
  readonly title: string;
  /** DeepSeek 的推理模式：开了更慢更贵，规划（决定问什么）可能更好。 */
  readonly thinking?: boolean;
};

export const MODELS: Readonly<Record<string, ModelSpec>> = {
  "deepseek-flash": { provider: "deepseek", id: "deepseek-flash", title: "DeepSeek V4.1 Flash" },
  "deepseek-flash-think": {
    provider: "deepseek",
    id: "deepseek-flash",
    title: "DeepSeek V4.1 Flash（开推理）",
    thinking: true,
  },
  "claude-sonnet-5-5": {
    provider: "aihubmix",
    id: "claude-sonnet-5-5",
    title: "Claude Sonnet 5.5",
  },
  "claude-haiku-5-5": { provider: "aihubmix", id: "claude-haiku-5-5", title: "Claude Haiku 5.5" },
  "gpt-6.1-sol": { provider: "aihubmix", id: "gpt-6.1-sol", title: "GPT 6.1 Sol" },
  "gpt-6-luna": { provider: "aihubmix", id: "gpt-6-luna", title: "GPT 6 Luna" },
};
export const DEFAULT_MODEL = "deepseek-flash";

export const resolveModel = (
  name: string | undefined,
): { ok: true; name: string } | { ok: false; error: string } => {
  const n = name?.trim() || DEFAULT_MODEL;
  return MODELS[n]
    ? { ok: true, name: n }
    : { ok: false, error: `没有这个模型：${n}（有：${Object.keys(MODELS).join("、")}）` };
};
