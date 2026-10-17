/**
 * 预设：任务层（mission）的命名文本，文件在仓库根的 profiles/*.md（随代码评审、随部署上线）。
 * 引擎（协议层，prompt.ts）固定；一个访谈要做什么——目的、范围、怎么问、什么算完成——由任务层决定。
 * 发链接时可以选一个预设、整段覆盖、或者在预设后面追加；解析后的最终文本在创建访谈时存进这个访谈（快照），
 * 之后改预设不会影响进行中的访谈。
 */
import blank from "../../profiles/blank.md?raw";
import crossBorderWebsite from "../../profiles/cross-border-website.md?raw";

export const PROFILES: Readonly<
  Record<string, { readonly title: string; readonly mission: string }>
> = {
  "cross-border-website": {
    title: "跨境贸易 / 服务网站的需求访谈（米站）",
    mission: crossBorderWebsite,
  },
  blank: { title: "没有预设", mission: blank },
};
export const DEFAULT_PROFILE = "cross-border-website";
export const MAX_MISSION = 12_000;

export type Resolved =
  | { readonly ok: true; readonly profile: string; readonly mission: string }
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
  };
};
