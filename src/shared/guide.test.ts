import { describe, expect, it } from "vitest";
import { guideText, MAX_BRIEF_CHARS } from "./guide.ts";

const text = guideText({
  origin: "https://x.example",
  templates: [{ name: "t1", title: "第一个模板", version: 3 }],
  defaultTemplate: "t1",
  models: [
    { name: "m1", title: "一号", available: true },
    { name: "m2", title: "二号", available: false },
  ],
  defaultModel: "m1",
});

describe("guideText: the one page an inviting agent reads", () => {
  it("says what the tool is and the three things the caller does", () => {
    expect(text).toContain("越问越短的表单");
    expect(text).toContain("发邀请 → 等 → 取记录");
  });

  it("lists the endpoints, the templates (with versions) and only the models that are available", () => {
    expect(text).toContain("POST https://x.example/admin/interviews");
    expect(text).toContain("`t1`（第一个模板，v3）");
    expect(text).toContain("`m1`");
    expect(text).not.toContain("`m2`");
  });

  it("documents the fields of a creation and the shape of the record, and that findings are checked for source, not meaning", () => {
    for (const field of [
      "criteria",
      "respondent",
      "intro",
      "pace",
      "capabilities",
      "notify",
      "language",
    ])
      expect(text).toContain(`\`${field}\``);
    expect(text).toContain("核对的是出处，不是意思");
    expect(text).toContain("digest");
    expect(text).toContain(String(MAX_BRIEF_CHARS));
  });

  it("says the callback is a sketch: once, no retry, no signature", () => {
    expect(text).toContain("不重试、不签名、不保证送达");
  });
});
