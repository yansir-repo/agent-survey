import { describe, expect, it } from "vitest";
import { richText, richToMarkdown, sanitizeRich } from "./rich.ts";

describe("sanitizeRich: client HTML is untrusted", () => {
  it("keeps the whitelist, drops scripts and event handlers, keeps the visible text", () => {
    const out = sanitizeRich(
      '<b onclick="x()">hi</b><script>alert(1)</script><img src=x onerror=1>',
    );
    expect(out).toBe("<b>hi</b>alert(1)");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
  });

  it("keeps a link only with a safe href; a javascript: link loses its tag, not its text", () => {
    expect(sanitizeRich('<a href="https://x.test/a?b=1">go</a>')).toBe(
      '<a href="https://x.test/a?b=1">go</a>',
    );
    expect(sanitizeRich('<a href="javascript:alert(1)">go</a>')).toBe("go");
    expect(sanitizeRich("<a>go</a>")).toBe("go");
  });

  it("escapes stray angle brackets and ampersands, and closes what was left open", () => {
    expect(sanitizeRich("a < b & c")).toBe("a &lt; b &amp; c");
    expect(sanitizeRich("<b>x<i>y")).toBe("<b>x<i>y</i></b>");
    expect(sanitizeRich("</b>x")).toBe("x");
  });

  it("normalises strong/em/div to b/i/p", () => {
    expect(sanitizeRich("<strong>a</strong><em>b</em><div>c</div>")).toBe(
      "<b>a</b><i>b</i><p>c</p>",
    );
  });

  it("is idempotent", () => {
    const once = sanitizeRich(
      '<p>a <b>b</b> <a href="https://x.test">c</a></p><ul><li>d</li></ul>',
    );
    expect(sanitizeRich(once)).toBe(once);
  });
});

describe("richText", () => {
  it("is empty for markup with no words in it", () => {
    expect(richText("<p></p><br><b> </b>")).toBe("");
    expect(richText("<p>hello</p><p>world</p>")).toBe("hello world");
  });
});

describe("richToMarkdown (what the agent reads)", () => {
  it("bold, italic, links", () => {
    expect(richToMarkdown('<b>a</b> and <i>b</i> <a href="https://x.test">c</a>')).toBe(
      "**a** and *b* [c](https://x.test)",
    );
  });

  it("unordered and ordered lists, nested lists indent", () => {
    expect(richToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
    expect(richToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
    expect(richToMarkdown("<ul><li>a<ul><li>b</li></ul></li></ul>")).toBe("- a\n  - b");
  });

  it("paragraphs and line breaks become newlines, never HTML", () => {
    const md = richToMarkdown("<p>one</p><p>two<br>three</p>");
    expect(md).toBe("one\ntwo\nthree");
    expect(md).not.toContain("<");
  });

  it("an unsafe script never reaches the agent as markup", () => {
    expect(richToMarkdown("<script>x</script>ok")).toBe("xok");
  });
});
