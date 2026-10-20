import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, MAX_MISSION, PROFILES, resolveMission } from "./profiles.ts";
import { systemPrompt } from "./prompt.ts";
import { STAGE_ROUNDS } from "./machine.ts";

describe("resolveMission: what a link is created with", () => {
  it("with nothing given it uses the default preset", () => {
    const r = resolveMission({});
    expect(r).toMatchObject({ ok: true, profile: DEFAULT_PROFILE });
    expect(r.ok ? r.mission : "").toBe(PROFILES[DEFAULT_PROFILE]!.mission);
  });

  it("a named preset, an unknown one is an error that lists the real ones", () => {
    expect(resolveMission({ profile: "blank" })).toMatchObject({ ok: true, profile: "blank" });
    const bad = resolveMission({ profile: "nope" });
    expect(bad.ok ? "" : bad.error).toContain("cross-border-website");
  });

  it("a full override replaces the preset's text (and is recorded as an override)", () => {
    const r = resolveMission({ mission: "只问颜色。" });
    expect(r).toMatchObject({ ok: true, mission: "只问颜色。" });
    expect(r.ok ? r.profile : "").toContain("整段覆盖");
  });

  it("an append goes after the preset, under its own heading", () => {
    const r = resolveMission({
      profile: "cross-border-website",
      append: "这个客户只做 B2B 服务。",
    });
    expect(r.ok ? r.mission : "").toContain(PROFILES["cross-border-website"]!.mission);
    expect(r.ok ? r.mission : "").toMatch(/## 这次的补充[\s\S]*只做 B2B/);
  });

  it("is bounded", () => {
    expect(resolveMission({ mission: "x".repeat(MAX_MISSION + 1) }).ok).toBe(false);
  });
});

describe("the two layers of the instructions", () => {
  const text = systemPrompt("MISSION-TEXT", "BRIEF-TEXT");

  it("the protocol is always there, whatever the mission says; the mission and the brief follow it", () => {
    expect(text).toContain("ask_round");
    expect(text).toContain("finish_interview");
    expect(text.indexOf("ask_round")).toBeLessThan(text.indexOf("MISSION-TEXT"));
    expect(text.indexOf("MISSION-TEXT")).toBeLessThan(text.indexOf("BRIEF-TEXT"));
  });

  it("no longer pushes few rounds or full rounds; says rounds are unbounded and the agent chooses how many questions", () => {
    expect(text).not.toContain("3–5 轮");
    expect(text).not.toContain("4–5");
    expect(text).toContain("轮数没有上限");
    expect(text).toContain("一轮问几题由你定");
  });

  it("files are collected after the interview, never in it", () => {
    const mission = PROFILES["cross-border-website"]!.mission;
    expect(mission).toContain("访谈不收文件");
    expect(mission).toContain("收集页");
    expect(mission).not.toContain("第一轮就问");
  });

  it("states the ultimate purpose, the independent finish check, and the search tool", () => {
    expect(text).toContain("不应该再回头找客户");
    expect(text).toContain("独立的检查者");
    expect(text).toContain("search_web");
  });

  it("tells the agent the checkpoint is urged after a full stage and the moment is its own choice", () => {
    expect(text).toContain(`问满 ${STAGE_ROUNDS} 轮之后`);
    expect(text).toContain("时机你选");
    expect(text).toContain("checkpoint");
  });

  it("the cross-border preset keeps the website scoped to the 'action' handoff (sales process stays out)", () => {
    const m = PROFILES["cross-border-website"]!.mission;
    expect(m).toContain("销售流程");
    expect(m).toContain("不在范围内");
    expect(m).toContain("完成的判据");
  });
});

describe("the two interviews", () => {
  it("has a developer preset whose deliverable is the build brief", () => {
    const p = PROFILES["build-brief"];
    expect(p).toBeDefined();
    expect(p!.mission).toContain("建站交底");
    expect(p!.mission).toContain("开发者");
    expect(p!.mission).toContain("CONTEXT.md");
    expect(p!.mission).toContain("不要做");
  });

  it("the client preset asks for the five facts the developer interview needs", () => {
    const m = PROFILES["cross-border-website"]!.mission;
    expect(m).toContain("开发者访谈");
    expect(m).toContain("现在有什么");
    expect(m).toContain("以后谁维护");
    expect(m).toContain("边界和硬约束");
    expect(m).toContain("参考");
  });

  it("the client preset's contract is CONTEXT.md + facts.json, with the independent judge", () => {
    const r = resolveMission({});
    expect(r).toMatchObject({ ok: true, stage: "client", judge: true });
    expect(r.ok ? r.deliverables : []).toEqual([
      { path: "/CONTEXT.md", format: "markdown", primary: true },
      {
        path: "/facts.json",
        format: "json",
        schema: "client-facts",
        gates: ["facts-five", "facts-no-placeholders", "references-distinct"],
      },
    ]);
  });

  it("the developer preset adds /model.json, gates, and turns the judge off", () => {
    const p = PROFILES["build-brief"]!;
    expect(p.stage).toBe("dev");
    expect(p.judge).toBe(false);
    expect(p.deliverables).toContainEqual(
      expect.objectContaining({ path: "/model.json", format: "json", schema: "site-model" }),
    );
    const model = p.deliverables.find((d) => d.path === "/model.json");
    expect(model?.gates).toContain("routes-match-pages");

    const r = resolveMission({ profile: "build-brief" });
    expect(r).toMatchObject({ ok: true, stage: "dev", judge: false });
  });
});
