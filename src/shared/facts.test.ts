import { describe, expect, it } from "vitest";
import { GATES, checkFacts, decodeFactsText, type ClientFacts } from "./facts.ts";

const valid = (): ClientFacts => ({
  format: 1,
  code: "mz-041",
  current: {
    site: "有一个 WordPress 站，外包在维护，产品页很旧",
    products: 30,
    cases: 12,
    articles: null,
    media: "hundreds",
    materials: "旧站后台 + 百度网盘 + 设计手里的 AI 文件",
  },
  taxonomy: {
    products: ["三辊闸", "摆闸", "翼闸"],
    markets: ["中东", "东南亚"],
    caseGroups: ["地铁", "园区", "商场"],
    buyerFinds: "先按品类，再看案例在哪个国家",
  },
  maintenance: {
    who: "老板的助理，改图找外包",
    frequency: "monthly",
    selfService: ["产品", "案例"],
  },
  constraints: {
    phaseOne: "英文站：30 款产品 + 案例 + 询盘",
    outOfScope: ["在线支付", "多语言"],
    domain: "acme-gate.com",
    host: "Hostinger",
    email: "sales@acme-gate.com",
    brandEnglish: "ACME Gate",
    certifications: ["CE", "ISO9001"],
  },
  references: [
    { url: "https://www.archdaily.com", like: true, why: "产品页干净，参数一眼能看完" },
    { url: "https://www.alibaba.com", like: false, why: "太挤，像批发市场" },
  ],
  action: {
    what: "填询盘表单，或点 WhatsApp",
    fields: ["name", "email", "country", "message"],
    response: "24 小时内邮件回复",
  },
});

const json = (f: ClientFacts): string => JSON.stringify(f);
const errorsOf = (f: ClientFacts): ReadonlyArray<string> => {
  const r = decodeFactsText(json(f));
  return r.ok ? checkFacts(r.facts) : r.errors;
};

describe("client facts", () => {
  it("decodes a complete facts sheet and every gate passes", () => {
    const r = decodeFactsText(json(valid()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(checkFacts(r.facts)).toEqual([]);
  });

  it("requires the five sections", () => {
    const { current: _current, ...rest } = valid();
    expect(decodeFactsText(JSON.stringify(rest)).ok).toBe(false);
  });

  it("the five key lines cannot be whitespace", () => {
    const f = valid();
    const current = { ...f.current, site: " " };
    expect(errorsOf({ ...f, current }).some((e) => e.includes("current.site"))).toBe(true);
  });

  it("refuses placeholder content and a sentence in the domain field", () => {
    const f = valid();
    const placeholder = { ...f.constraints, email: "sales@example.com" };
    expect(errorsOf({ ...f, constraints: placeholder }).some((e) => e.includes("占位内容"))).toBe(
      true,
    );

    const sentence = { ...f.constraints, domain: "沿用现有老站域名（客户答不出具体网址）" };
    expect(decodeFactsText(json({ ...f, constraints: sentence })).ok).toBe(false);
  });

  it("refuses the same reference URL twice", () => {
    const f = valid();
    const references = [f.references[0]!, { ...f.references[0]!, like: false }];
    expect(errorsOf({ ...f, references }).some((e) => e.includes("同一个网址出现多次"))).toBe(true);
  });

  it("allows unknown counts and an empty form", () => {
    const f = valid();
    const current = { ...f.current, products: null, cases: null, articles: null };
    const action = { ...f.action, fields: [] };
    const r = decodeFactsText(json({ ...f, current, action }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(checkFacts(r.facts)).toEqual([]);
  });

  it("the gates are registered by name", () => {
    expect(Object.keys(GATES).sort()).toEqual([
      "facts-five",
      "facts-no-placeholders",
      "references-distinct",
    ]);
  });
});
