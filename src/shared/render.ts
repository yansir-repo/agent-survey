/**
 * 客户的回答 → agent 读的文字。agent 不读 HTML、不读 JSON，只读 Markdown：每题一节，
 * 没答的明说“客户选择稍后再答”（不留空白，让 agent 无从误会成“客户没意见”）。文件题只列路径，内容 agent 自己去工作区读。
 */
import type { FileInfo } from "./api.ts";
import { markdownPath } from "./files.ts";
import type { Question, Value } from "./questions.ts";
import { richToMarkdown } from "./rich.ts";

/** 一个答案的 Markdown 正文（不含标题）。 */
export const valueMarkdown = (q: Question, v: Value, files: ReadonlyArray<FileInfo>): string => {
  switch (q.kind) {
    case "single":
    case "text":
    case "long":
      return String(v);
    case "number":
      return `${String(v)}${q.unit ? ` ${q.unit}` : ""}`;
    case "multi":
    case "link":
      return (v as ReadonlyArray<string>).map((x) => `- ${x}`).join("\n");
    case "rich":
      return richToMarkdown(String(v));
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

export type Answered = { readonly question: Question; readonly value: Value | null };

/** 一轮的回答。value 为 null = 客户选了稍后再答。 */
export const answersMarkdown = (
  items: ReadonlyArray<Answered>,
  files: ReadonlyArray<FileInfo>,
): string =>
  items
    .map(({ question, value }) =>
      [
        `### ${question.title}`,
        `（题目 id：${question.id}，方式：${question.kind}）`,
        value === null
          ? "客户选择稍后再答（系统会在最后补问，你不用重复问）。"
          : valueMarkdown(question, value, files),
      ].join("\n"),
    )
    .join("\n\n");
