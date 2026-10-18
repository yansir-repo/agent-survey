import { describe, expect, it } from "vitest";
import { COMPOUND_AT, PICK_AT, readTitle, titleProblems, titleRequest } from "./clef-gates.ts";

const probs = (cmp: number, pick: number) => ({
  cmp: { choice: "single", confidence: 1, probabilities: { single: 1 - cmp, multiple: cmp } },
  pick: { choice: "write", confidence: 1, probabilities: { pick, write: 1 - pick } },
});

describe("title gates", () => {
  it("asks two closed questions about one title, and nothing about the rest of the interview", () => {
    const r = titleRequest("几个？分别是谁？", "long");
    expect(Object.keys(r.questions)).toEqual(["cmp", "pick"]);
    expect(r.state).toEqual({ 题: "几个？分别是谁？", 方式: "long" });
  });
  it("sends a compound question back, and an essay question that could be a choice", () => {
    const v = readTitle(probs(COMPOUND_AT + 0.1, PICK_AT + 0.1));
    expect(titleProblems("a", "long", v)).toHaveLength(2);
  });
  it("only essay kinds are told to become choices; an unreadable verdict is no problem", () => {
    expect(titleProblems("a", "text", readTitle(probs(0, 0.9)))).toEqual([]);
    expect(titleProblems("a", "long", { compound: null, pick: null })).toEqual([]);
  });
});
