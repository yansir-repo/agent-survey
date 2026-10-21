/**
 * NOTES.md 给受访者看：一个很小的 Markdown → HTML。agent 写的文档会有标题、列表、表格、引用、粗体——只认这些。
 * 先转义再加标签（文档内容是数据，不是标记）；链接只放行 http(s)。纯函数，不依赖 DOM。
 */

const esc = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** 行内：`code`、**粗体**、*斜体*、[文字](http…)。输入已转义。 */
const inline = (raw: string): string =>
  esc(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
const isSep = (line: string): boolean =>
  /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/.test(line);
const isTableStart = (lines: ReadonlyArray<string>, i: number): boolean =>
  lines[i]!.includes("|") && i + 1 < lines.length && isSep(lines[i + 1]!);

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export const markdownToHtml = (md: string): string => {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!))
        body.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(`<blockquote>${body.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(lines[i]!);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "")
        rows.push(cells(lines[i++]!));
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (!m) break;
        items.push(`<li${m[1]!.length >= 2 ? ' class="sub"' : ""}>${inline(m[3]!)}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!) &&
      !isTableStart(lines, i)
    )
      para.push(lines[i++]!);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
};
