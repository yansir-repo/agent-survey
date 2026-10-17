import { describe, expect, it } from "vitest";
import {
  OTHER_PREFIX,
  QUESTION_KINDS,
  parseAskRound,
  uploadDir,
  validateAnswer,
  type Question,
} from "./questions.ts";

const q = <K extends Question["kind"]>(kind: K, extra: Record<string, unknown> = {}): Question =>
  ({ id: "q1", kind, title: "T", why: "W", ...extra }) as Question;
const single = q("single", { options: [{ label: "A" }, { label: "B", hint: "h" }] });

describe("the closed vocabulary", () => {
  it("has exactly the kinds the MVP supports (no archive, no video)", () => {
    expect([...QUESTION_KINDS]).toEqual([
      "single",
      "multi",
      "number",
      "text",
      "long",
      "rich",
      "link",
      "image",
      "file",
    ]);
  });
});

describe("parseAskRound", () => {
  const ok = (questions: unknown[]) => ({ intro: "hi", questions });

  it("accepts 1-5 well-formed questions", () => {
    const r = parseAskRound(ok([{ id: "a", kind: "text", title: "T", why: "W" }]), new Set());
    expect(r.ok).toBe(true);
  });

  it("rejects zero or more than five questions", () => {
    expect(parseAskRound(ok([]), new Set()).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({
      id: `q${i}`,
      kind: "text",
      title: "T",
      why: "W",
    }));
    expect(parseAskRound(ok(six), new Set()).ok).toBe(false);
  });

  it("rejects an unknown kind, an extra key, a single-choice with one option", () => {
    expect(
      parseAskRound(ok([{ id: "a", kind: "archive", title: "T", why: "W" }]), new Set()).ok,
    ).toBe(false);
    expect(
      parseAskRound(ok([{ id: "a", kind: "text", title: "T", why: "W", surprise: 1 }]), new Set())
        .ok,
    ).toBe(false);
    expect(
      parseAskRound(
        ok([{ id: "a", kind: "single", title: "T", why: "W", options: [{ label: "x" }] }]),
        new Set(),
      ).ok,
    ).toBe(false);
  });

  it("an upload question cannot carry its own format promise (hint is not allowed)", () => {
    expect(
      parseAskRound(
        ok([{ id: "a", kind: "file", title: "T", why: "W", hint: "PPT 都行" }]),
        new Set(),
      ).ok,
    ).toBe(false);
    expect(
      parseAskRound(ok([{ id: "a", kind: "file", title: "T", why: "W", max: 3 }]), new Set()).ok,
    ).toBe(true);
  });

  it("a question can be marked optional (blank is fine), and nothing else about it changes", () => {
    const r = parseAskRound(
      ok([{ id: "a", kind: "long", title: "T", why: "W", optional: true }]),
      new Set(),
    );
    expect(r.ok).toBe(true);
    expect(
      parseAskRound(
        ok([{ id: "a", kind: "long", title: "T", why: "W", optional: "yes" }]),
        new Set(),
      ).ok,
    ).toBe(false);
  });

  it("every question must say why it is asked", () => {
    expect(parseAskRound(ok([{ id: "a", kind: "text", title: "T" }]), new Set()).ok).toBe(false);
  });

  it("ids are unique inside a round and never reused from earlier rounds (so an old answer can never be overwritten)", () => {
    const dup = [
      { id: "a", kind: "text", title: "T", why: "W" },
      { id: "a", kind: "long", title: "T", why: "W" },
    ];
    const r1 = parseAskRound(ok(dup), new Set());
    expect(r1.ok ? "" : r1.error).toContain("重复");
    const r2 = parseAskRound(ok([dup[0]]), new Set(["a"]));
    expect(r2.ok ? "" : r2.error).toContain("用过");
  });
});

describe("the free-text 'other' option the system adds to every single/multi question", () => {
  const ok = (questions: unknown[]) => ({ intro: "hi", questions });
  const multi = q("multi", { options: [{ label: "A" }, { label: "B" }] });

  it("the agent's own 其他 options are removed (the customer would see two); a real option that merely starts with 其他 stays", () => {
    const r = parseAskRound(
      ok([
        {
          id: "a",
          kind: "single",
          title: "T",
          why: "W",
          options: [
            { label: "A" },
            { label: "B" },
            { label: "其他" },
            { label: "其他（请说明）" },
            { label: "其他地区" },
          ],
        },
      ]),
      new Set(),
    );
    expect(r.ok).toBe(true);
    const labels =
      r.ok && r.round.questions[0]!.kind === "single"
        ? r.round.questions[0]!.options.map((o) => o.label)
        : [];
    expect(labels).toEqual(["A", "B", "其他地区"]);
  });

  it("if removing them leaves fewer than two real options, the agent is told why", () => {
    const r = parseAskRound(
      ok([
        {
          id: "a",
          kind: "multi",
          title: "T",
          why: "W",
          options: [{ label: "A" }, { label: "其他" }],
        },
      ]),
      new Set(),
    );
    expect(r.ok ? "" : r.error).toContain("不足 2 个");
  });

  it("single: a written answer is accepted as 其他：text, trimmed, never empty, bounded", () => {
    expect(validateAnswer(single, `${OTHER_PREFIX}  我自己的  `)).toEqual({
      ok: true,
      value: "其他：我自己的",
    });
    expect(validateAnswer(single, OTHER_PREFIX).ok).toBe(false);
    expect(validateAnswer(single, `${OTHER_PREFIX}${"x".repeat(201)}`).ok).toBe(false);
    expect(validateAnswer(single, "其他").ok).toBe(false); // 没有前缀的“其他”不是选项
  });

  it("multi: options plus at most one written addition", () => {
    expect(validateAnswer(multi, ["A", `${OTHER_PREFIX}C`])).toEqual({
      ok: true,
      value: ["A", "其他：C"],
    });
    expect(validateAnswer(multi, [`${OTHER_PREFIX}C`])).toEqual({ ok: true, value: ["其他：C"] });
    expect(validateAnswer(multi, [`${OTHER_PREFIX}C`, `${OTHER_PREFIX}D`]).ok).toBe(false);
    expect(validateAnswer(multi, ["A", OTHER_PREFIX]).ok).toBe(false);
    expect(validateAnswer(multi, ["Z"]).ok).toBe(false);
  });
});

describe("validateAnswer", () => {
  it("single: one of the options; multi: a non-empty subset, de-duplicated", () => {
    expect(validateAnswer(single, "A")).toEqual({ ok: true, value: "A" });
    expect(validateAnswer(single, "Z").ok).toBe(false);
    const multi = q("multi", { options: [{ label: "A" }, { label: "B" }] });
    expect(validateAnswer(multi, ["A", "A", "B"])).toEqual({ ok: true, value: ["A", "B"] });
    expect(validateAnswer(multi, []).ok).toBe(false);
    expect(validateAnswer(multi, ["C"]).ok).toBe(false);
  });

  it("number: finite, within bounds, strings of digits are numbers", () => {
    const n = q("number", { min: 0, max: 100 });
    expect(validateAnswer(n, "30")).toEqual({ ok: true, value: 30 });
    expect(validateAnswer(n, 101).ok).toBe(false);
    expect(validateAnswer(n, "abc").ok).toBe(false);
    expect(validateAnswer(n, "").ok).toBe(false);
  });

  it("text trims and refuses empty; long keeps newlines; rich is sanitised and needs words", () => {
    expect(validateAnswer(q("text"), "  hi \n there ")).toEqual({ ok: true, value: "hi there" });
    expect(validateAnswer(q("text"), "   ").ok).toBe(false);
    expect(validateAnswer(q("long"), " a\nb ")).toEqual({ ok: true, value: "a\nb" });
    expect(validateAnswer(q("rich"), "<p></p>").ok).toBe(false);
    expect(validateAnswer(q("rich"), "<b>x</b><script>y</script>")).toEqual({
      ok: true,
      value: "<b>x</b>y",
    });
  });

  it("link: http(s) urls only, at most max", () => {
    const l = q("link", { max: 2 });
    expect(validateAnswer(l, ["https://a.test", " https://a.test "])).toEqual({
      ok: true,
      value: ["https://a.test"],
    });
    expect(validateAnswer(l, ["javascript:alert(1)"]).ok).toBe(false);
    expect(validateAnswer(l, ["abc"]).ok).toBe(false);
    expect(validateAnswer(l, ["https://a.test", "https://b.test", "https://c.test"]).ok).toBe(
      false,
    );
  });

  it("file/image: only paths under this question's own upload directory", () => {
    const f = q("file");
    expect(validateAnswer(f, [`${uploadDir("q1")}a.pdf`])).toEqual({
      ok: true,
      value: ["uploads/q1/a.pdf"],
    });
    expect(validateAnswer(f, ["uploads/q2/a.pdf"]).ok).toBe(false);
    expect(validateAnswer(f, ["uploads/q1/../q2/a.pdf"]).ok).toBe(false);
    expect(validateAnswer(f, []).ok).toBe(false);
  });
});
