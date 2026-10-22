/**
 * 受访者的回答 → agent 读的文字。agent 不读 HTML、不读 JSON，只读 Markdown：每题一节，
 * 没答的明说“受访者选择稍后再答”（不留空白，让 agent 无从误会成“受访者没意见”）。文件题只列路径，内容 agent 自己去工作区读。
 */
import type { FileInfo } from "./api.ts";
import { markdownPath } from "./files.ts";
import { isOther, otherText, type Question, type Value } from "./questions.ts";
import { richToMarkdown } from "./rich.ts";

/** 受访者自己写的选项（“其他：xxx”）要让 agent 看得出这不是你给的选项。 */
const plainOption = (v: string): string =>
  isOther(v) ? `其他（受访者自己写的）：${otherText(v)}` : v;

/** 一个答案的 Markdown 正文（不含标题）。 */
export const valueMarkdown = (q: Question, v: Value, files: ReadonlyArray<FileInfo>): string => {
  switch (q.kind) {
    case "single":
      // 检查点里“其他”那个选项是受访者的纠正（otherLabel 只有检查点用）
      return q.otherLabel !== undefined && isOther(String(v))
        ? `受访者纠正（他写的）：${otherText(String(v))}`
        : plainOption(String(v));
    case "text":
    case "long":
      return String(v);
    case "number":
      return `${String(v)}${q.unit ? ` ${q.unit}` : ""}`;
    case "multi":
      return (v as ReadonlyArray<string>).map((x) => `- ${plainOption(x)}`).join("\n");
    case "link":
      return (v as ReadonlyArray<string>).map((x) => `- ${x}`).join("\n");
    case "rich":
      return richToMarkdown(String(v));
    case "secret":
      return "受访者已填写（加密保存，你看不到内容，也不要让他在别处再写一遍；只需知道已经给了）";
    case "image":
    case "file":
      return (v as ReadonlyArray<string>)
        .map((p) => {
          const f = files.find((x) => x.path === p);
          if (!f) return `- /${p}（找不到这个文件）`;
          return f.status === "ok"
            ? `- /${p}（已解析成文字，读 /${markdownPath(p)}；${f.size} 字节${f.tokens ? `，约 ${f.tokens} token` : ""}）`
            : `- /${p}（收到了，但没能解析成文字：${f.note ?? "原因不明"}；你只能知道它存在）`;
        })
        .join("\n");
  }
};

/** value 为 null：受访者选了稍后再答；blank：选填题受访者没写（空着就是空着，不会补问）。 */
export type Answered = {
  readonly question: Question;
  readonly value: Value | null;
  readonly blank?: boolean;
};

/** 一轮的回答。value 为 null = 受访者选了稍后再答。 */
export const answersMarkdown = (
  items: ReadonlyArray<Answered>,
  files: ReadonlyArray<FileInfo>,
  note = "",
): string => {
  const body = items
    .map(({ question, value, blank }) =>
      [
        `### ${question.title}`,
        `（题目 id：${question.id}，方式：${question.kind}）`,
        blank
          ? "受访者没有填写（这是选填题，空着就是空着，不用再问）。"
          : value === null
            ? "受访者选择稍后再答（系统会在最后补问，你不用重复问）。"
            : valueMarkdown(question, value, files),
      ].join("\n"),
    )
    .join("\n\n");
  return note.trim() === ""
    ? body
    : `${body}\n\n### 受访者在这一轮底部额外补充的话（自由输入，不是你问的）\n${note.trim()}`;
};
