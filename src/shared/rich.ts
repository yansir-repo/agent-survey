/**
 * 富文本：客户在编辑框里写的 HTML 是不可信输入。这里只做两件事，且只在这里做：
 *  - sanitizeRich：白名单净化（只留 b i u ul ol li p br a[href]；其余标签一律去掉标签保留文字）；
 *  - richToMarkdown：净化后的 HTML → Markdown，给 agent 读（agent 不读 HTML）。
 * 不依赖 DOM：Worker 里没有。
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c] ?? c);
const unesc = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const ALIAS: Record<string, string> = { strong: "b", em: "i", div: "p" };
const KEEP = new Set(["b", "i", "u", "ul", "ol", "li", "p", "br", "a"]);
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;

type Token =
  | { readonly t: "text"; readonly s: string }
  | { readonly t: "open" | "close"; readonly tag: string; readonly href?: string };

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;

const tokenize = (html: string): Token[] => {
  const out: Token[] = [];
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    if (m.index > last) out.push({ t: "text", s: unesc(html.slice(last, m.index)) });
    last = m.index + m[0].length;
    const raw = (m[2] ?? "").toLowerCase();
    const tag = ALIAS[raw] ?? raw;
    if (!KEEP.has(tag)) continue; // 去掉标签，文字留着
    if (m[1] === "/") {
      out.push({ t: "close", tag });
      continue;
    }
    const href = tag === "a" ? /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(m[3] ?? "") : null;
    const url = href ? unesc(href[1] ?? href[2] ?? "") : "";
    out.push(
      tag === "a" && SAFE_HREF.test(url) ? { t: "open", tag, href: url } : { t: "open", tag },
    );
  }
  if (last < html.length) out.push({ t: "text", s: unesc(html.slice(last)) });
  return out;
};

/** 净化：只留白名单标签，a 只留安全的 href，没有闭合的标签补齐，文字转义。 */
export const sanitizeRich = (html: string): string => {
  const stack: string[] = [];
  let out = "";
  for (const tok of tokenize(html)) {
    if (tok.t === "text") out += esc(tok.s);
    else if (tok.t === "open") {
      if (tok.tag === "br") out += "<br>";
      else if (tok.tag === "a" && !tok.href) continue; // 没有安全地址的链接：丢掉标签，文字还在
      else {
        stack.push(tok.tag);
        out += tok.tag === "a" ? `<a href="${esc(tok.href ?? "")}">` : `<${tok.tag}>`;
      }
    } else if (tok.tag !== "br") {
      const i = stack.lastIndexOf(tok.tag);
      if (i < 0) continue;
      while (stack.length > i) out += `</${stack.pop()}>`;
    }
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
};

/** 纯文字（没有任何标签），判断“有没有写东西”用。 */
export const richText = (html: string): string =>
  tokenize(html)
    .map((t) =>
      t.t === "text" ? t.s : t.t === "close" && (t.tag === "p" || t.tag === "li") ? " " : "",
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** 净化后的 HTML → Markdown。 */
export const richToMarkdown = (html: string): string => {
  const lists: Array<{ ordered: boolean; n: number }> = [];
  const links: string[] = [];
  let md = "";
  for (const tok of tokenize(sanitizeRich(html))) {
    if (tok.t === "text") {
      md += tok.s;
      continue;
    }
    const open = tok.t === "open";
    switch (tok.tag) {
      case "b":
        md += "**";
        break;
      case "i":
      case "u":
        md += tok.tag === "i" ? "*" : "";
        break;
      case "br":
        md += "\n";
        break;
      case "p":
        md += open ? (md.endsWith("\n") || md === "" ? "" : "\n") : "\n";
        break;
      case "ul":
      case "ol":
        if (open) lists.push({ ordered: tok.tag === "ol", n: 0 });
        else lists.pop();
        if (!open) md += md.endsWith("\n") ? "" : "\n";
        break;
      case "li": {
        const l = lists[lists.length - 1];
        if (open) {
          if (l) l.n += 1;
          md += `${md.endsWith("\n") || md === "" ? "" : "\n"}${"  ".repeat(Math.max(0, lists.length - 1))}${l?.ordered ? `${l.n}. ` : "- "}`;
        } else md += "\n";
        break;
      }
      case "a":
        if (open) {
          links.push(tok.href ?? "");
          md += "[";
        } else md += `](${links.pop() ?? ""})`;
        break;
    }
  }
  return md.replace(/\n{3,}/g, "\n\n").trim();
};
