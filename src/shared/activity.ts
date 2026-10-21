/**
 * 等待时“它在干什么”：把访谈者的一次工具调用说成一句受访者看得懂的话（读资料、打开网页、搜索、记笔记）。
 * 提问/检查点/结束这些“结束回合”的调用不算活动（它们的结果受访者马上看到）。
 */
const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const base = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;
const host = (u: string): string => (URL.canParse(u) ? new URL(u).hostname : u);

export const describeCall = (tool: string, input: unknown): string | null => {
  const i = isObject(input) ? input : {};
  switch (tool) {
    case "read": {
      const p = str(i["path"]) || str(i["file_path"]);
      return p === ""
        ? "正在读资料"
        : p.endsWith("NOTES.md")
          ? "回看自己的笔记"
          : `正在读「${base(p.replace(/\.md$/, ""))}」`;
    }
    case "list":
    case "find":
    case "grep":
      return "正在翻看资料目录";
    case "write":
    case "edit":
      return "正在整理笔记（NOTES.md）";
    case "fetch_page": {
      const u = str(i["url"]);
      return u === "" ? "正在打开网页" : `正在打开网页 ${host(u)}`;
    }
    case "search_web": {
      const q = str(i["query"]);
      return q === "" ? "正在上网搜索" : `正在上网搜索「${q.slice(0, 30)}」`;
    }
    default:
      return null;
  }
};

/** 活动列表只留最近几条，连续重复的合并。 */
export const MAX_ACTIVITY = 6;
export const pushActivity = (
  list: ReadonlyArray<string>,
  line: string | null,
): ReadonlyArray<string> =>
  line === null || list.at(-1) === line ? list : [...list, line].slice(-MAX_ACTIVITY);
