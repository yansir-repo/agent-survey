import { describe, expect, it } from "vitest";
import { askableOf, finishRefusal, parseJudge } from "./finish-judge.ts";
import { recordText } from "./record.ts";
import { formatSearch } from "./web.ts";

describe("parseJudge", () => {
  it("reads the checker's JSON, with or without a code fence", () => {
    const j =
      '{"open":[{"item":"起价口径","kind":"askable","ask":"选择题"},{"item":"重排规格书","kind":"ours"}]}';
    expect(parseJudge(j)?.map((i) => i.kind)).toEqual(["askable", "ours"]);
    expect(parseJudge("```json\n" + j + "\n```")).toHaveLength(2);
  });
  it("an unreadable answer is null (treated as 'checker unavailable'), not 'nothing left'", () => {
    expect(parseJudge("好的，没问题")).toBeNull();
    expect(parseJudge('{"open":[{"item":"x","kind":"maybe"}]}')).toBeNull();
  });
  it("only askable items block, at most six, and the refusal is the list", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      item: `事${i}`,
      kind: "askable" as const,
    }));
    expect(askableOf([...items, { item: "z", kind: "cannot" as const }])).toHaveLength(6);
    expect(finishRefusal(askableOf(items), 1)).toContain("1. 事0");
  });
});

describe("recordText: the facts are the answers, not the write-up", () => {
  const text = recordText(
    "背景",
    [
      {
        seq: 1,
        kind: "agent",
        questions: [
          { id: "a", title: "做什么的？", kind: "single" },
          { id: "b", title: "给个数", kind: "number" },
          { id: "c", title: "多选", kind: "multi" },
        ],
        answers: {
          a: { skipped: false, value: "其他：我是做服务的" },
          b: { skipped: true, value: null },
          c: { skipped: false, value: ["甲", "乙"] },
        },
        note: "补充一句",
      },
    ],
    [{ path: "uploads/q1/a.pdf", head: "规格书 Rev.2026" }],
  );
  it("shows customer-written answers, skips, multi values, notes and file heads", () => {
    expect(text).toContain("（客户自己写的）我是做服务的");
    expect(text).toContain("〔客户选了稍后再答〕");
    expect(text).toContain("甲；乙");
    expect(text).toContain("补充一句");
    expect(text).toContain("规格书 Rev.2026");
  });
});

describe("formatSearch", () => {
  it("lists title, source, date, url and summary; empty is said plainly", () => {
    const s = formatSearch("沙特 SABER", {
      results: [
        {
          title: "T",
          url: "https://x.y/z",
          summary: "摘要",
          site_name: "站",
          date: "2026-05-01T00:00:00Z",
        },
      ],
    });
    expect(s).toContain("T（站 · 2026-05-01）");
    expect(s).toContain("https://x.y/z");
    expect(formatSearch("q", { results: [] })).toContain("没有搜到");
  });
});
