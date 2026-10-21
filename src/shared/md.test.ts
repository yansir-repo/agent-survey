import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./md.ts";

describe("markdownToHtml (NOTES.md for the customer)", () => {
  it("headings, paragraphs, lists, quotes, bold", () => {
    const h = markdownToHtml("# T\n\n正文 **重点**\n\n- a\n- b\n\n> 原话");
    expect(h).toContain("<h2>T</h2>");
    expect(h).toContain("<strong>重点</strong>");
    expect(h).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(h).toContain("<blockquote>原话</blockquote>");
  });
  it("tables", () => {
    const h = markdownToHtml("| 市场 | 状态 |\n|---|---|\n| 沙特 | 在办 |\n| 巴西 | 没有 |");
    expect(h).toContain("<th>市场</th>");
    expect(h).toContain("<td>在办</td>");
    expect(h.match(/<tr>/g)).toHaveLength(3);
  });
  it("document text is data: tags are escaped, only http(s) links survive", () => {
    const h = markdownToHtml(
      "<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](https://x.com/y)",
    );
    expect(h).not.toContain("<img");
    expect(h).not.toContain('href="javascript');
    expect(h).toContain('<a href="https://x.com/y"');
  });
  it("code blocks are verbatim", () => {
    expect(markdownToHtml("```\n<b>*x*</b>\n```")).toContain("&lt;b&gt;*x*&lt;/b&gt;");
  });
});
