import { describe, expect, it } from "vitest";
import { askableOf, finishRefusal, parseJudge } from "./finish-judge.ts";
import { recordText } from "./record.ts";
import { repeatsPending, similarity } from "./repeat.ts";
import { formatSearch } from "./web.ts";

const item = (
  kind: "askable" | "ours" | "cannot" | "later",
  name: string,
  deferred: string | null = null,
) => ({
  item: name,
  kind,
  deferred,
});

describe("parseJudge", () => {
  const j =
    '{"open":[{"item":"起价口径","kind":"askable","ask":"选择题","deferred":null},{"item":"重排规格书","kind":"ours","deferred":null}]}';
  it("reads the checker's JSON, with or without a code fence", () => {
    expect(parseJudge(j)?.map((i) => i.kind)).toEqual(["askable", "ours"]);
    expect(parseJudge("```json\n" + j + "\n```")).toHaveLength(2);
  });
  it("null for the fields that do not apply (ask) is fine — the model writes it for ours/cannot/later", () => {
    expect(
      parseJudge('{"open":[{"item":"x","kind":"ours","ask":null,"deferred":null}]}'),
    ).toHaveLength(1);
  });
  it("an unreadable answer is null (treated as 'checker unavailable'), not 'nothing left'", () => {
    expect(parseJudge("好的，没问题")).toBeNull();
    expect(parseJudge('{"open":[{"item":"x","kind":"maybe","deferred":null}]}')).toBeNull();
    // deferred 是必填：漏了它，就当检查者没有认真答
    expect(parseJudge('{"open":[{"item":"x","kind":"askable"}]}')).toBeNull();
  });
  it("only askable items block, at most six, and the refusal is the list", () => {
    const items = Array.from({ length: 9 }, (_, i) => item("askable", `事${i}`));
    expect(askableOf([...items, item("cannot", "z")])).toHaveLength(6);
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
  it("shows customer-written answers, skips (with their id), multi values, notes and file heads", () => {
    expect(text).toContain("（客户自己写的）我是做服务的");
    expect(text).toContain("〔客户选了稍后再答，编号 b〕");
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

describe("deferred questions are not 'still to ask' (live: one fact appeared 3 times in 20 deferred)", () => {
  it("an item the checker ties to a pending deferred question does not block the finish; a made-up id does not help", () => {
    const items = [
      item("askable", "WhatsApp 号", "q_wa"),
      item("askable", "起价口径"),
      item("askable", "编号乱填", "nope"),
    ];
    expect(askableOf(items, new Set(["q_wa"])).map((i) => i.item)).toEqual([
      "起价口径",
      "编号乱填",
    ]);
  });
  it("re-asking a pending deferred question word for word, or nearly, is refused", () => {
    const pending = [
      { id: "upload_catalog", title: "把现在的 PDF 目录或报价单传上来（有几个传几个）" },
    ];
    expect(
      repeatsPending(
        [{ id: "f", title: "把现有的 PDF 目录或报价单传上来（有几个传几个）" }],
        pending,
      ),
    ).toHaveLength(1);
    expect(repeatsPending([{ id: "g", title: "网站要做几种语言？" }], pending)).toEqual([]);
    expect(similarity("abc", "")).toBe(0);
  });
});
