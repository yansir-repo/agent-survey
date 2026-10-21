import { describe, expect, it } from "vitest";
import {
  CRITERION_SYSTEM,
  criterionUser,
  finishRefusal,
  parseVerdict,
  unmetOf,
} from "./finish-judge.ts";

const RECORD = "Q（single）谁拍板？\nA 我自己拍板，助理小李日常对接";

describe("parseVerdict: one clause, one verdict, checked against the record", () => {
  const say = (v: unknown) => JSON.stringify(v);

  it("is met only with a quote that really is in the record (whitespace aside)", () => {
    const ok = parseVerdict(
      say({ met: true, evidence: "我自己拍板，助理小李 日常对接", note: "" }),
      "问清了谁拍板",
      RECORD,
    );
    expect(ok).toMatchObject({ met: true, evidence: "我自己拍板，助理小李 日常对接" });
  });

  it("a quote the record does not hold is not evidence, however confident the judge is", () => {
    const made = parseVerdict(
      say({ met: true, evidence: "老板说过交给财务", note: "" }),
      "问清了谁拍板",
      RECORD,
    );
    expect(made).toMatchObject({ met: false, evidence: null });
    expect(made?.note).toContain("找不到");
  });

  it("met without any quote is not met", () => {
    expect(parseVerdict(say({ met: true, evidence: null }), "x", RECORD)).toMatchObject({
      met: false,
    });
    expect(parseVerdict(say({ met: true }), "x", RECORD)).toMatchObject({ met: false });
  });

  it("not met keeps the judge's reason; fences are tolerated; unreadable output is null", () => {
    expect(
      parseVerdict(
        "```json\n" + say({ met: false, evidence: null, note: "没问过" }) + "\n```",
        "x",
        RECORD,
      ),
    ).toMatchObject({
      met: false,
      note: "没问过",
    });
    expect(parseVerdict("我觉得成立", "x", RECORD)).toBeNull();
  });
});

describe("what goes to the judge and back to the agent", () => {
  it("one clause per request, with the goal and the raw record", () => {
    const u = criterionUser("弄清谁拍板", "问清了谁拍板", RECORD);
    expect(u).toContain("# 验收条款\n问清了谁拍板");
    expect(u).toContain("弄清谁拍板");
    expect(u).toContain(RECORD);
    expect(CRITERION_SYSTEM).toContain("逐字");
  });

  it("the refusal is the list of unmet clauses and says how many blocks are left", () => {
    const unmet = unmetOf([
      { criterion: "A", met: true, evidence: "x", note: "" },
      { criterion: "B", met: false, evidence: null, note: "没问过" },
    ]);
    expect(unmet.map((j) => j.criterion)).toEqual(["B"]);
    const text = finishRefusal(unmet, 1);
    expect(text).toContain("1. B（没问过）");
    expect(text).toContain("最多再拦你 1 次");
  });
});
