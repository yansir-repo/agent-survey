import { describe, expect, it } from "vitest";
import { guideText } from "./guide.ts";

const g = guideText({
  origin: "https://x.example",
  profiles: [{ name: "p1", title: "第一个预设" }],
  defaultProfile: "p1",
  models: [
    { name: "m-on", title: "开", available: true },
    { name: "m-off", title: "关", available: false },
  ],
  defaultModel: "m-on",
});

describe("the agent guide", () => {
  it("names every operator endpoint an agent needs, with the real origin", () => {
    for (const s of [
      "POST https://x.example/admin/interviews",
      "/result",
      "/rotate",
      "DELETE /admin/interviews/<code>",
      "/admin/guide",
      "/llms.txt",
    ])
      expect(g).toContain(s);
  });
  it("lists the live profiles and only the models that are available", () => {
    expect(g).toContain("`p1`（第一个预设）");
    expect(g).toContain("`m-on`");
    expect(g).not.toContain("`m-off`");
  });
  it("never carries a credential", () => {
    expect(g).not.toMatch(/Bearer [A-Za-z0-9]{16,}/);
  });
});
