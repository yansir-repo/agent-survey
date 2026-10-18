import { describe, expect, it } from "vitest";
import { completeJson, liveView } from "./live.ts";

describe("completeJson: half a JSON document is read as far as it goes", () => {
  it("closes open strings, arrays and objects", () => {
    expect(completeJson('{"a":[1,2')).toEqual({ a: [1, 2] });
    expect(completeJson('{"title":"你们有没')).toEqual({ title: "你们有没" });
  });
  it("steps back from a dangling key or colon", () => {
    expect(completeJson('{"a":1,"b":')).toEqual({ a: 1 });
    expect(completeJson('{"a":1,"bc')).toEqual({ a: 1 });
  });
  it("gives up on garbage", () => {
    expect(completeJson("")).toBeUndefined();
  });
});

describe("liveView", () => {
  const args =
    '{"delta":"d","intro":"开场","questions":[{"id":"a","kind":"single","title":"第一题？","options":[{"label":"甲"},{"label":"乙"}]},{"id":"b","kind":"text","title":"第二';
  it("lists the questions as far as they are written; the last one is still being written", () => {
    const v = liveView("想想", args);
    expect(v.intro).toBe("开场");
    expect(v.questions.map((q) => [q.title, q.options, q.writing])).toEqual([
      ["第一题？", ["甲", "乙"], false],
      ["第二", [], true],
    ]);
  });
  it("keeps only the tail of a long reasoning text", () => {
    expect(liveView("x".repeat(5000), "").reasoning.length).toBeLessThan(800);
  });
});
