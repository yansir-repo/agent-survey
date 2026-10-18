/** 预置网址的入口检查：每个都要过公网地址守卫（同 fetch_page），出处要写对，最多 20 个。 */
import { checkPublicUrl } from "./url-guard.ts";
import { isSource, type ProvidedUrl } from "./provided.ts";

export const MAX_PROVIDED_URLS = 20;

export const parseProvidedUrls = (
  input: unknown,
): { ok: true; urls: ProvidedUrl[] } | { ok: false; error: string } => {
  if (input === undefined || input === null) return { ok: true, urls: [] };
  if (!Array.isArray(input) || input.length > MAX_PROVIDED_URLS)
    return { ok: false, error: `urls 要是一个数组，最多 ${MAX_PROVIDED_URLS} 个` };
  const urls: ProvidedUrl[] = [];
  for (const item of input) {
    const rec = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const url = typeof rec["url"] === "string" ? rec["url"] : "";
    if (!isSource(rec["source"]))
      return { ok: false, error: `网址 ${url || "（空）"}：source 要写 client 或 ours` };
    const checked = checkPublicUrl(url);
    if (!checked.ok) return { ok: false, error: `网址 ${url || "（空）"}：${checked.error}` };
    urls.push({ url: checked.url.toString(), source: rec["source"] });
  }
  return { ok: true, urls };
};
