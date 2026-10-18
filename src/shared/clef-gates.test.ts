import { describe, expect, it } from "vitest";
import { COMPOUND_AT, compoundProblems, readCompound, titleRequest } from "./clef-gates.ts";

const answer = (p: number) => ({
  cmp: { choice: "single", confidence: 1, probabilities: { single: 1 - p, multiple: p } },
});

describe("title gate", () => {
  it("asks one closed question about one title, and nothing about the rest of the interview", () => {
    const r = titleRequest("几个？分别是谁？", "long");
    expect(Object.keys(r.questions)).toEqual(["cmp"]);
    expect(r.state).toEqual({ 题: "几个？分别是谁？", 方式: "long" });
  });
  it("sends a compound question back", () => {
    expect(compoundProblems("a", readCompound(answer(COMPOUND_AT + 0.1)))).toHaveLength(1);
    expect(compoundProblems("a", readCompound(answer(0.1)))).toEqual([]);
  });
  it("an unreadable verdict is no problem", () => {
    expect(compoundProblems("a", readCompound({}))).toEqual([]);
  });
});
