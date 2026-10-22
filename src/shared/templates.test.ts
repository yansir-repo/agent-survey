import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEC,
  DEFAULT_TEMPLATE,
  MAX_GOAL,
  TEMPLATES,
  resolveTemplate,
  specOf,
} from "./templates.ts";

describe("resolveTemplate: what an interview is created with", () => {
  it("with nothing given it uses the default template and leaves everything open", () => {
    const r = resolveTemplate({});
    expect(r).toMatchObject({ ok: true, label: DEFAULT_TEMPLATE });
    expect(r.ok ? r.goal : "").toBe(TEMPLATES[DEFAULT_TEMPLATE]!.goal);
    expect(r.ok ? r.spec : null).toMatchObject({
      criteria: [],
      pace: { maxRounds: null, perRound: null },
      capabilities: { web: true, search: true, uploads: true },
    });
  });

  it("a named template brings its criteria and defaults, snapshotted with its version", () => {
    const r = resolveTemplate({ template: "cross-border-website" });
    expect(r.ok ? r.spec.template : null).toEqual({
      name: "cross-border-website",
      version: TEMPLATES["cross-border-website"]!.version,
    });
    expect(r.ok ? r.spec.criteria.length : 0).toBeGreaterThan(0);
    expect(r.ok ? r.spec.respondent : "").not.toBe("");
  });

  it("an unknown template is an error that lists the real ones", () => {
    const bad = resolveTemplate({ template: "nope" });
    expect(bad.ok ? "" : bad.error).toContain("blank");
  });

  it("a full goal replaces the template's text; an append goes after it, under its own heading", () => {
    const o = resolveTemplate({ goal: "只问颜色。" });
    expect(o).toMatchObject({ ok: true, goal: "只问颜色。" });
    expect(o.ok ? o.label : "").toContain("整段覆盖");
    const a = resolveTemplate({ template: "cross-border-website", append: "这位只做 B2B 服务。" });
    expect(a.ok ? a.goal : "").toContain(TEMPLATES["cross-border-website"]!.goal);
    expect(a.ok ? a.goal : "").toMatch(/## 这次的补充[\s\S]*只做 B2B/);
  });

  it("the caller's own criteria, pace, capabilities, language and notify override the template", () => {
    const r = resolveTemplate({
      template: "cross-border-website",
      criteria: ["问清了谁拍板", "  "],
      pace: { maxRounds: 5 },
      capabilities: { uploads: false },
      language: "English",
      notify: "https://example.com/hook",
    });
    expect(r.ok ? r.spec : null).toMatchObject({
      criteria: ["问清了谁拍板"],
      pace: { maxRounds: 5, perRound: null },
      capabilities: { web: true, search: true, uploads: false },
      language: "English",
      notify: "https://example.com/hook",
    });
  });

  it("refuses what cannot be a goal, a clause, a limit or an address", () => {
    expect(resolveTemplate({ goal: "x".repeat(MAX_GOAL + 1) }).ok).toBe(false);
    expect(resolveTemplate({ criteria: "一条" }).ok).toBe(false);
    expect(resolveTemplate({ criteria: Array.from({ length: 13 }, (_, i) => `条 ${i}`) }).ok).toBe(
      false,
    );
    expect(resolveTemplate({ pace: { maxRounds: 0 } }).ok).toBe(false);
    expect(resolveTemplate({ capabilities: { web: "yes" } }).ok).toBe(false);
    expect(resolveTemplate({ notify: "ftp://x" }).ok).toBe(false);
  });
});

describe("specOf: a snapshot an older interview left behind", () => {
  it("fills what is missing with the defaults: nothing limited, everything open", () => {
    expect(specOf({ stage: "client", deliverables: [{ path: "/NOTES.md" }], judge: true })).toEqual(
      DEFAULT_SPEC,
    );
    expect(specOf(null)).toEqual(DEFAULT_SPEC);
  });
});

describe("fixed questions", () => {
  it("take the inquirer's questions, prefix their ids, and refuse a malformed one", () => {
    const r = resolveTemplate({
      template: "blank",
      goal: "收上线要用的权限",
      fixed: [
        { id: "host-pw", kind: "secret", title: "主机后台密码", why: "搬站要登录" },
        { kind: "text", title: "域名注册商", why: "改解析" },
      ],
    });
    expect(r.ok && r.spec.fixed.map((q) => [q.id, q.kind])).toEqual([
      ["fx-host-pw", "secret"],
      ["fx-q2", "text"],
    ]);
    expect(resolveTemplate({ template: "blank", fixed: [{ kind: "secret" }] }).ok).toBe(false);
    expect(
      specOf({ fixed: [{ id: "fx-a", kind: "secret", title: "t", why: "w" }, { junk: 1 }] }).fixed,
    ).toHaveLength(1);
  });
});
