import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { buildBundle, bundleMarkdown, digestOf, questionOf, type BundleInput } from "./bundle.ts";
import type { Question } from "./questions.ts";

const q: Question = {
  kind: "single",
  id: "q1",
  title: "谁拍板？",
  why: "决定找谁确认",
  mode: "guess",
  options: [{ label: "我自己", hint: "老板" }, { label: "一个团队" }],
};

const input = (over: Partial<BundleInput> = {}): BundleInput => ({
  id: "acme-1",
  phase: "done",
  template: { name: "blank", version: 1 },
  goal: "弄清谁拍板",
  brief: "背景",
  respondent: "",
  language: "中文",
  model: "m",
  rounds: [
    {
      seq: 1,
      kind: "agent",
      intro: "先问一个",
      delta: "第一轮，尚无回答",
      questions: [questionOf(q)],
      answers: [{ qid: "q1", value: "我自己", skipped: false }],
      note: "补充一句",
    },
  ],
  findings: [
    { id: 1, statement: "拍板的是他本人", basis: [{ ref: "answer:q1", quote: "我自己" }], at: 1 },
  ],
  summary: "弄清了",
  unanswered: [],
  validation: null,
  files: [
    {
      path: "uploads/q2/a.pdf",
      name: "a.pdf",
      mime: "application/pdf",
      size: 10,
      qid: "q2",
      status: "ok",
      r2Key: "acme-1/uploads/q2/a.pdf",
    },
    {
      path: "provided/respondent/b.md",
      name: "b.md",
      mime: "text/markdown",
      size: 5,
      qid: "provided-respondent",
      status: "ok",
      r2Key: "k",
    },
    {
      path: "provided/inquirer/c.md",
      name: "c.md",
      mime: "text/markdown",
      size: 5,
      qid: "provided-inquirer",
      status: "unconverted",
      r2Key: "k2",
    },
  ],
  pages: [{ n: 1, url: "https://example.com", size: 99 }],
  deferredRoundOpened: false,
  ...over,
});

describe("buildBundle: lay out what was stored, judge nothing", () => {
  it("keeps the question as it was asked: options, mode, why", () => {
    const b = buildBundle(input());
    expect(b.rounds[0]!.questions[0]).toMatchObject({
      id: "q1",
      mode: "guess",
      options: [
        { label: "我自己", hint: "老板" },
        { label: "一个团队", hint: null },
      ],
    });
    expect(b.rounds[0]!.answers).toEqual([{ qid: "q1", value: "我自己", skipped: false }]);
  });

  it("names every material by where it came from: asked of the respondent, given by either side, or read by the agent", () => {
    const b = buildBundle(input());
    expect(b.materials.map((m) => [m.ref, m.source])).toEqual([
      ["file:uploads/q2/a.pdf", "uploaded"],
      ["file:provided/respondent/b.md", "respondent"],
      ["file:provided/inquirer/c.md", "inquirer"],
      ["page:1", "fetched"],
    ]);
    expect(b.materials[2]!.status).toBe("unconverted");
  });

  it("says who finished it, and nothing until it is done", () => {
    expect(buildBundle(input()).finishedBy).toBe("agent");
    expect(buildBundle(input({ deferredRoundOpened: true })).finishedBy).toBe("deferred-round");
    expect(buildBundle(input({ phase: "asking" })).finishedBy).toBeNull();
  });
});

describe("the readable version and the digest", () => {
  it("is rendered mechanically and keeps the interpretation apart from the answers", () => {
    const md = bundleMarkdown(buildBundle(input()));
    expect(md).toContain('A "我自己"');
    expect(md).toContain("## agent 的解读（不是受访者的话）");
    expect(md.indexOf("第 1 轮")).toBeLessThan(md.indexOf("agent 的解读"));
  });

  it.effect("changes when anything in the record changes, and only then", () =>
    Effect.gen(function* () {
      const a = yield* digestOf(buildBundle(input()));
      expect(yield* digestOf(buildBundle(input()))).toBe(a);
      expect(yield* digestOf(buildBundle(input({ summary: "别的" })))).not.toBe(a);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    }),
  );
});
