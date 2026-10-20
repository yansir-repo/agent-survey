/**
 * 预设：任务层（mission）+ 交付物契约（deliverables / judge）。
 * 任务层写在仓库根的 profiles/*.md；交付物契约在这里，和 mission 一起在创建访谈时快照进 DO。
 *
 * 一个预设 = 一段话（agent 怎么问）+ 一份清单（系统怎么判它做完了）：
 *   deliverables  每份交付物的路径、格式、schema、gate；`primary` 是 result 的 context
 *   judge         是否再用独立检查者判“还缺什么”（散文任务需要；有结构化契约的开发者访谈可以关）
 */
import blank from "../../profiles/blank.md?raw";
import buildBrief from "../../profiles/build-brief.md?raw";
import crossBorderWebsite from "../../profiles/cross-border-website.md?raw";
import type { Deliverable } from "./deliverables.ts";
import { FACTS_GATES } from "./facts.ts";
import { MODEL_GATES } from "./model.ts";
import { CONTEXT_PATH } from "./prompt.ts";

const CONTEXT: Deliverable = { path: CONTEXT_PATH, format: "markdown", primary: true };
/** 客户访谈的结构化事实：五类只有客户知道、开发者访谈一定会用到的东西。 */
const CLIENT_FACTS: Deliverable = {
  path: "/facts.json",
  format: "json",
  schema: "client-facts",
  gates: FACTS_GATES,
};
/** 开发者访谈的机器契约：BSP + 内容模型；散文交底仍在 CONTEXT.md。 */
const SITE_MODEL: Deliverable = {
  path: "/model.json",
  format: "json",
  schema: "site-model",
  gates: MODEL_GATES,
};

export type Stage = "client" | "dev";

export type ProfileSpec = {
  readonly title: string;
  readonly mission: string;
  readonly stage: Stage;
  readonly deliverables: ReadonlyArray<Deliverable>;
  readonly judge: boolean;
};

export const PROFILES: Readonly<Record<string, ProfileSpec>> = {
  "cross-border-website": {
    title: "跨境贸易 / 服务网站的需求访谈（米站）",
    mission: crossBorderWebsite,
    stage: "client",
    deliverables: [CONTEXT, CLIENT_FACTS],
    judge: true,
  },
  "build-brief": {
    title: "开发者访谈：把客户访谈变成建站交底（米站）",
    mission: buildBrief,
    stage: "dev",
    deliverables: [CONTEXT, SITE_MODEL],
    judge: false,
  },
  blank: {
    title: "没有预设",
    mission: blank,
    stage: "client",
    deliverables: [CONTEXT],
    judge: true,
  },
};
export const DEFAULT_PROFILE = "cross-border-website";
export const MAX_MISSION = 12_000;

/** 未知预设但给了整段 mission 时的退路：客户场，只有 CONTEXT.md，照旧用检查者。 */
const FALLBACK = {
  stage: "client" as const,
  deliverables: [CONTEXT],
  judge: true,
};

export type Resolved =
  | {
      readonly ok: true;
      readonly profile: string;
      readonly mission: string;
      readonly stage: Stage;
      readonly deliverables: ReadonlyArray<Deliverable>;
      readonly judge: boolean;
    }
  | { readonly ok: false; readonly error: string };

/** 发链接时的三种用法：只选预设（默认用 DEFAULT_PROFILE）、`mission` 整段覆盖、`append` 在后面追加。 */
export const resolveMission = (o: {
  profile?: string;
  mission?: string;
  append?: string;
}): Resolved => {
  const name = o.profile?.trim() || DEFAULT_PROFILE;
  const override = o.mission?.trim() ?? "";
  const preset = PROFILES[name];
  if (override === "" && !preset)
    return { ok: false, error: `没有这个预设：${name}（有：${Object.keys(PROFILES).join("、")}）` };
  const base = override !== "" ? override : (preset?.mission ?? "");
  const append = o.append?.trim() ?? "";
  const mission = append === "" ? base : `${base}\n\n## 这次的补充\n\n${append}`;
  if (mission.length > MAX_MISSION)
    return { ok: false, error: `任务描述太长了（最多 ${MAX_MISSION} 个字）` };
  return {
    ok: true,
    profile: override !== "" ? `${name}（整段覆盖）` : append !== "" ? `${name}（有补充）` : name,
    mission,
    stage: preset?.stage ?? FALLBACK.stage,
    deliverables: preset?.deliverables ?? FALLBACK.deliverables,
    judge: preset?.judge ?? FALLBACK.judge,
  };
};
