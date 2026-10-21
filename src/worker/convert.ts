/**
 * 文件 → Markdown。Worker 只有一个入口：Workers AI 的 `toMarkdown`（PDF / Office / OpenDocument / CSV / HTML / XML /
 * 图片，官方清单），纯文本我们自己读。开发模式没有 AI 绑定：只有纯文本能转，其余如实报告，不假装。
 *
 * 转换失败不是异常，是结果：文件照样收下（原件在 R2），agent 被告知“收到了但没能解析”。
 */
import { Effect } from "effect";
import { classify, extOf, mimeOf } from "../shared/files.ts";

export type Converted =
  | { readonly ok: true; readonly markdown: string; readonly tokens: number }
  | { readonly ok: false; readonly error: string };

/** 工作区里放的 Markdown 上限（字符）：再长的文档 agent 也是分段读，没必要整本进 SQLite。 */
export const MAX_MARKDOWN_CHARS = 400_000;

const approxTokens = (s: string) => Math.ceil(s.length / 3);
const clip = (s: string): string =>
  s.length > MAX_MARKDOWN_CHARS ? `${s.slice(0, MAX_MARKDOWN_CHARS)}\n\n…（太长，已截断）` : s;
/** tryPromise 默认会把失败包成一句泛泛的话；真正的原因在 cause 里，agent 和提问方要看到的是它。 */
const message = (e: unknown): string => {
  const cause =
    typeof e === "object" && e !== null && "cause" in e ? (e as { cause: unknown }).cause : e;
  return cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "解析失败";
};

export const convertFile = (
  ai: Ai | undefined,
  name: string,
  bytes: ArrayBuffer,
): Effect.Effect<Converted> => {
  // 纯文本我们自己读。CSV 也是：toMarkdown 把 CSV 当 Latin-1 读（实测：中文表头全是乱码），而它本来就是文字，UTF-8 解码后原样给 agent 读。
  const csv = extOf(name) === "csv";
  if (classify(name) === "text" || csv) {
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const markdown = clip(csv ? `\`\`\`csv\n${decoded.trimEnd()}\n\`\`\`` : decoded);
    return Effect.succeed({ ok: true, markdown, tokens: approxTokens(markdown) });
  }
  if (!ai) return Effect.succeed({ ok: false, error: "这个环境没有 Workers AI，无法解析这种文件" });
  return Effect.tryPromise(() =>
    ai.toMarkdown({ name, blob: new Blob([bytes], { type: mimeOf(name) }) }),
  ).pipe(
    Effect.map((r): Converted => {
      if (r.format === "error") return { ok: false, error: r.error || "解析失败" };
      const markdown = clip(r.data);
      return markdown.trim() === ""
        ? { ok: false, error: "解析出来是空的（可能是扫描件，没有文字层）" }
        : { ok: true, markdown, tokens: r.tokens ?? approxTokens(markdown) };
    }),
    Effect.catch((e) => Effect.succeed<Converted>({ ok: false, error: message(e) })),
  );
};

/** 一段 HTML（网页）转 Markdown。 */
export const htmlToMarkdown = (ai: Ai | undefined, html: string): Effect.Effect<Converted> =>
  convertFile(ai, "page.html", new TextEncoder().encode(html).buffer as ArrayBuffer);
