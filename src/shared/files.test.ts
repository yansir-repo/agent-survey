import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  acceptFor,
  formatsText,
  acceptsKind,
  classify,
  markdownPath,
  rejectReason,
  safeName,
  uniquePath,
} from "./files.ts";

describe("what we accept", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(classify("A.PDF")).toBe("doc");
    expect(classify("x.docx")).toBe("doc");
    expect(classify("logo.SVG")).toBe("image");
    expect(classify("notes.md")).toBe("text");
    expect(classify("deck.pptx")).toBeNull();
    expect(classify("noext")).toBeNull();
  });

  it("says why a file is refused, in words a customer can act on", () => {
    expect(rejectReason("a.zip", 10)).toContain("压缩包");
    expect(rejectReason("a.mp4", 10)).toContain("视频");
    expect(rejectReason("a.pptx", 10)).toContain("PDF");
    expect(rejectReason("a.pdf", 0)).toContain("空");
    expect(rejectReason("a.pdf", MAX_FILE_BYTES + 1)).toContain("MB");
    expect(rejectReason("a.pdf", 10)).toBeNull();
  });

  it("an image question takes images only; a file question takes documents, text and images", () => {
    expect(acceptsKind("image", "a.png")).toBe(true);
    expect(acceptsKind("image", "a.pdf")).toBe(false);
    expect(acceptsKind("file", "a.pdf")).toBe(true);
    expect(acceptsKind("file", "a.png")).toBe(true);
    expect(acceptFor("image")).toContain(".png");
    expect(acceptFor("image")).not.toContain(".pdf");
    expect(acceptFor("file")).toContain(".docx");
  });
});

describe("the format text the customer reads comes from the same list", () => {
  it("never promises what we refuse", () => {
    expect(formatsText("file")).toContain("PDF");
    expect(formatsText("file")).toContain("暂不支持 PowerPoint");
    expect(formatsText("image")).not.toContain("PDF");
  });
});

describe("paths", () => {
  it("safeName strips directories, control characters and leading dots, keeps the extension, limits length", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("C:\\x\\a b.pdf")).toBe("a b.pdf");
    expect(safeName("..hidden.txt")).toBe("hidden.txt");
    expect(safeName("a\u0000b?.pdf")).toBe("ab.pdf");
    const long = safeName(`${"x".repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(safeName("")).toBe("file");
  });

  it("uniquePath never overwrites: a taken name gets -2, -3", () => {
    const taken = new Set(["uploads/q1/a.pdf", "uploads/q1/a-2.pdf"]);
    expect(uniquePath("uploads/q1/", "a.pdf", taken)).toBe("uploads/q1/a-3.pdf");
    expect(uniquePath("uploads/q1/", "b.pdf", taken)).toBe("uploads/q1/b.pdf");
  });

  it("the converted markdown sits next to the original", () => {
    expect(markdownPath("uploads/q1/a.pdf")).toBe("uploads/q1/a.pdf.md");
  });
});
