import { describe, expect, it } from "vitest";
import type { FileInfo } from "./api.ts";
import type { Question } from "./questions.ts";
import { answersMarkdown, valueMarkdown } from "./render.ts";

const q = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ id: "q1", kind, title: "T", why: "W", ...extra }) as Question;

describe("what the agent reads", () => {
  it("a skipped question says so explicitly, never blank", () => {
    const md = answersMarkdown([{ question: q("text"), value: null }], []);
    expect(md).toContain("稍后再答");
    expect(md).toContain("不用重复问");
  });

  it("rich text arrives as markdown, not HTML", () => {
    expect(valueMarkdown(q("rich"), "<b>a</b><ul><li>x</li></ul>", [])).toBe("**a**\n- x");
  });

  it("number carries its unit; multi and links are lists", () => {
    expect(valueMarkdown(q("number", { unit: "条 / 月" }), 30, [])).toBe("30 条 / 月");
    expect(valueMarkdown(q("multi", { options: [] }), ["A", "B"], [])).toBe("- A\n- B");
    expect(valueMarkdown(q("link"), ["https://a.test"], [])).toBe("- https://a.test");
  });

  it("files: converted ones point at the markdown, unconverted ones say they cannot be read", () => {
    const files: FileInfo[] = [
      { path: "uploads/q1/a.pdf", name: "a.pdf", size: 10, qid: "q1", status: "ok", tokens: 120 },
      {
        path: "uploads/q1/b.pdf",
        name: "b.pdf",
        size: 20,
        qid: "q1",
        status: "unconverted",
        note: "扫描件没有文字层",
      },
    ];
    const md = valueMarkdown(
      q("file"),
      ["uploads/q1/a.pdf", "uploads/q1/b.pdf", "uploads/q1/c.pdf"],
      files,
    );
    expect(md).toContain("/uploads/q1/a.pdf.md");
    expect(md).toContain("120");
    expect(md).toContain("没能解析成文字：扫描件没有文字层");
    expect(md).toContain("找不到这个文件");
  });
});
