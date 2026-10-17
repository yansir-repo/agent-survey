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

  it("collecting materials is the agent's judgement, not a stage requirement", () => {
    expect(text).toContain("由你判断");
    expect(text).not.toContain("第一轮就问");
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
