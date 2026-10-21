import { describe, expect, it } from "vitest";
import { checkFinding, type Sources } from "./findings.ts";

const sources: Sources = {
  answer: (qid) => (qid === "q1" ? "我自己拍板，助理小李日常对接" : null),
  note: (id) => (id === "r1" ? "补充：域名我再想想" : null),
  file: (path) => (path === "provided/a.pdf" ? "我们有 CE 和 ISO9001 认证" : null),
  page: (n) => (n === "1" ? "Gate A — turnstiles since 1990" : null),
};

describe("checkFinding: an interpretation must point at the record and quote it", () => {
  it("takes a conclusion whose quotes are really there, whitespace aside", () => {
    const r = checkFinding(
      {
        statement: "拍板的是他本人",
        basis: [{ ref: "answer:q1", quote: "我自己拍板，助理小李 日常对接" }],
      },
      sources,
    );
    expect(r.ok).toBe(true);
  });

  it("can rest on a file, a page and a round note as well", () => {
    expect(
      checkFinding(
        {
          statement: "有两项认证；站点老；域名没定",
          basis: [
            { ref: "file:provided/a.pdf", quote: "CE 和 ISO9001" },
            { ref: "page:1", quote: "turnstiles since 1990" },
            { ref: "note:r1", quote: "域名我再想想" },
          ],
        },
        sources,
      ).ok,
    ).toBe(true);
  });

  it("refuses a quote that is not at that place, a place that does not exist, and a conclusion without a basis", () => {
    const wrong = checkFinding(
      { statement: "x", basis: [{ ref: "answer:q1", quote: "交给财务" }] },
      sources,
    );
    expect(wrong.ok ? "" : wrong.error).toContain("找不到这句话");
    expect(
      (
        checkFinding({ statement: "x", basis: [{ ref: "answer:q9", quote: "x" }] }, sources) as {
          error: string;
        }
      ).error,
    ).toContain("没有 answer:q9");
    expect(
      (checkFinding({ statement: "x", basis: [] }, sources) as { error: string }).error,
    ).toContain("必须有依据");
    expect(
      (
        checkFinding({ statement: "x", basis: [{ ref: "memory:1", quote: "x" }] }, sources) as {
          error: string;
        }
      ).error,
    ).toContain("写法不对");
  });

  it("refuses an empty or oversized conclusion and unknown fields", () => {
    expect(
      checkFinding({ statement: " ", basis: [{ ref: "answer:q1", quote: "拍板" }] }, sources).ok,
    ).toBe(false);
    expect(
      checkFinding(
        { statement: "x".repeat(601), basis: [{ ref: "answer:q1", quote: "拍板" }] },
        sources,
      ).ok,
    ).toBe(false);
    expect(checkFinding({ statement: "x", basis: [], extra: 1 }, sources).ok).toBe(false);
  });
});
