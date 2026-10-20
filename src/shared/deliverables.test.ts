import { describe, expect, it } from "vitest";
import { checkDeliverable, type Deliverable } from "./deliverables.ts";
import type { Model } from "./model.ts";

const model: Model = {
  format: 1,
  code: "mz-1",
  summary: "一个只有首页的小站。",
  locales: { default: "en", enabled: ["en"] },
  types: [
    {
      name: "page",
      title: "Page",
      routes: { single: "/" },
      fields: [{ name: "title", label: "Title", kind: "text" }],
    },
  ],
  vocabularies: [],
  pages: [{ path: "/", title: "Home", job: "介绍业务", kind: "single", type: "page" }],
};

const json = (m: Model): string => JSON.stringify(m);
const modelFile: Deliverable = {
  path: "/model.json",
  format: "json",
  schema: "site-model",
  gates: ["pages-unique"],
};

describe("deliverables", () => {
  it("markdown only has to be non-empty", () => {
    expect(checkDeliverable({ path: "/CONTEXT.md", format: "markdown" }, "  ").ok).toBe(false);
    expect(checkDeliverable({ path: "/CONTEXT.md", format: "markdown" }, "# 理解").ok).toBe(true);
  });

  it("a JSON deliverable decodes and runs the named gates", () => {
    const ok = checkDeliverable(modelFile, json(model));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.text).toContain('"format": 1');

    const dup = { ...model, pages: [...model.pages, { ...model.pages[0]! }] };
    const bad = checkDeliverable(modelFile, json(dup));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("路径重复");
  });

  it("client facts are a second registered artifact with their own gates", () => {
    const facts = {
      format: 1,
      current: {
        site: "旧站是 WordPress，外包维护",
        products: 30,
        cases: null,
        articles: null,
        media: "hundreds",
        materials: "网盘 + 旧站后台",
      },
      taxonomy: {
        products: ["闸机"],
        markets: ["中东"],
        caseGroups: [],
        buyerFinds: "按品类找",
      },
      maintenance: { who: "老板助理", frequency: "monthly", selfService: ["产品"] },
      constraints: {
        phaseOne: "英文站",
        outOfScope: [],
        email: "sales@acme.com",
        certifications: [],
      },
      references: [],
      action: { what: "填询盘", fields: ["email"], response: "24 小时内" },
    };
    const file: Deliverable = { path: "/facts.json", format: "json", schema: "client-facts" };
    expect(checkDeliverable(file, JSON.stringify(facts)).ok).toBe(true);

    const bad = { ...facts, constraints: { ...facts.constraints, email: "sales@example.com" } };
    const refused = checkDeliverable(file, JSON.stringify(bad));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("占位内容");
  });

  it("an unknown schema or gate is a configuration error, not a silent pass", () => {
    expect(checkDeliverable({ ...modelFile, schema: "nope" }, json(model)).ok).toBe(false);
    const badGate = checkDeliverable({ ...modelFile, gates: ["nope"] }, json(model));
    expect(badGate.ok).toBe(false);
    if (!badGate.ok) expect(badGate.error).toContain("没有这个 gate");
  });

  it("malformed JSON is reported as such", () => {
    const bad = checkDeliverable(modelFile, "{");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("不是合法的 JSON");
  });
});
