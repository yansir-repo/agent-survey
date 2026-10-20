import { describe, expect, it } from "vitest";
import { checkModel, decodeModelText, type Model } from "./model.ts";

/** 一份完整、能过全部 gate 的模型：产品目录 + 询盘。 */
const valid = (): Model => ({
  format: 1,
  code: "mz-041",
  summary: "户外家具工厂的英文站：访客看产品、案例，最后发询盘。",
  locales: { default: "en", enabled: ["en"] },
  types: [
    {
      name: "product",
      title: "Products",
      routes: { collection: "/products/", record: "/products/:slug/" },
      fields: [
        { name: "code", label: "Model", kind: "text", required: true },
        { name: "category", label: "Category", kind: "term", vocabulary: "category" },
        {
          name: "certs",
          label: "Certifications",
          kind: "term",
          vocabulary: "cert",
          multiple: true,
        },
        {
          name: "specs",
          label: "Specifications",
          kind: "list",
          columns: [
            { name: "key", label: "Parameter" },
            { name: "value", label: "Value" },
          ],
        },
        { name: "photos", label: "Photos", kind: "media", of: "image", multiple: true },
      ],
    },
    {
      name: "inquiry",
      title: "Inquiries",
      routes: { internal: true },
      fields: [
        { name: "name", label: "Name", kind: "text", required: true },
        { name: "email", label: "Email", kind: "text", required: true },
        { name: "message", label: "Message", kind: "text" },
      ],
      intake: { fields: ["name", "email", "message"], notify: ["sales@acme.com"] },
    },
  ],
  vocabularies: [
    { name: "category", title: "Product Categories", terms: [{ id: "outdoor", label: "Outdoor" }] },
    { name: "cert", title: "Certifications" },
  ],
  pages: [
    { path: "/", title: "Home", job: "把访客分到产品线", kind: "single" },
    {
      path: "/products/",
      title: "Products",
      job: "按分类和认证筛型号",
      kind: "collection",
      type: "product",
    },
    {
      path: "/products/:slug/",
      title: "Product",
      job: "参数、认证、案例，导向询盘",
      kind: "record",
      type: "product",
    },
    { path: "/about/", title: "About", job: "工厂与交付能力", kind: "single" },
    { path: "/contact/", title: "Contact", job: "询盘表单", kind: "form", type: "inquiry" },
  ],
});

const json = (m: Model): string => JSON.stringify(m);
const errorsOf = (m: Model): ReadonlyArray<string> => {
  const r = decodeModelText(json(m));
  return r.ok ? checkModel(r.model) : r.errors;
};

describe("site model", () => {
  it("decodes a complete model and every gate passes", () => {
    const r = decodeModelText(json(valid()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(checkModel(r.model)).toEqual([]);
  });

  it("refuses text that is not JSON, and unknown members", () => {
    expect(decodeModelText("not json").ok).toBe(false);
    const extra = { ...valid(), extra: 1 };
    expect(decodeModelText(JSON.stringify(extra)).ok).toBe(false);
  });

  it("paths must be unique", () => {
    const m = valid();
    const pages = [...m.pages, { ...m.pages[1]!, path: "/products/" }];
    expect(errorsOf({ ...m, pages }).some((e) => e.includes("路径重复"))).toBe(true);
  });

  it("every page needs a job", () => {
    const m = valid();
    const pages = m.pages.map((p, i) => (i === 0 ? { ...p, job: " " } : p));
    expect(errorsOf({ ...m, pages }).some((e) => e.includes("job 是空的"))).toBe(true);
  });

  it("a type route needs a page with that path, kind and type", () => {
    const m = valid();
    const missing = m.pages.filter((p) => p.path !== "/products/");
    expect(errorsOf({ ...m, pages: missing }).some((e) => e.includes("没有对应的 page"))).toBe(
      true,
    );
    const wrong = m.pages.map((p) => (p.path === "/products/" ? { ...p, type: "inquiry" } : p));
    expect(errorsOf({ ...m, pages: wrong }).some((e) => e.includes("对不上"))).toBe(true);
  });

  it("term / ref / choice / list / media must name something real", () => {
    const m = valid();
    const fields = m.types[0]!.fields.map((f) =>
      f.name === "category" ? { ...f, vocabulary: "nope" } : f,
    );
    const types = [{ ...m.types[0]!, fields }, m.types[1]!];
    expect(errorsOf({ ...m, types }).some((e) => e.includes("vocabulary「nope」不存在"))).toBe(
      true,
    );

    const choice = {
      ...m.types[0]!,
      fields: [...m.types[0]!.fields, { name: "kind", label: "Kind", kind: "choice" as const }],
    };
    expect(
      errorsOf({ ...m, types: [choice, m.types[1]!] }).some((e) =>
        e.includes("choice 需要至少 2 个 options"),
      ),
    ).toBe(true);
  });

  it("intake only on an internal type, with fillable fields", () => {
    const m = valid();
    const inquiry = {
      ...m.types[1]!,
      routes: { single: "/contact/" },
      intake: { fields: ["name", "email", "phone"], notify: ["sales@example.com"] },
    };
    const errors = errorsOf({ ...m, types: [m.types[0]!, inquiry] });
    expect(errors.some((e) => e.includes("路由不是 internal"))).toBe(true);
    expect(errors.some((e) => e.includes("intake 字段「phone」不存在"))).toBe(true);
  });

  it("a utility page may name a data source, but it must exist", () => {
    const m = valid();
    const pages = [
      ...m.pages,
      {
        path: "/downloads/",
        title: "Downloads",
        job: "下载全部图纸",
        kind: "utility" as const,
        type: "product",
      },
    ];
    expect(errorsOf({ ...m, pages })).toEqual([]);

    const bad = pages.map((p) => (p.path === "/downloads/" ? { ...p, type: "nope" } : p));
    expect(errorsOf({ ...m, pages: bad }).some((e) => e.includes("type nope 不存在"))).toBe(true);
  });

  it("refuses a placeholder notification address", () => {
    const m = valid();
    const inquiry = {
      ...m.types[1]!,
      intake: { fields: ["name", "email", "message"], notify: ["sales@example.com"] },
    };
    expect(
      errorsOf({ ...m, types: [m.types[0]!, inquiry] }).some((e) => e.includes("占位邮箱")),
    ).toBe(true);
  });

  it("a form page must point at an internal intake type", () => {
    const m = valid();
    const noType = m.pages.map((p) => (p.path === "/contact/" ? { ...p, type: undefined } : p));
    expect(errorsOf({ ...m, pages: noType }).some((e) => e.includes("表单页，必须写 type"))).toBe(
      true,
    );

    const wrong = m.pages.map((p) => (p.path === "/contact/" ? { ...p, type: "product" } : p));
    expect(errorsOf({ ...m, pages: wrong }).some((e) => e.includes("不是 internal"))).toBe(true);

    const noForm = m.pages.filter((p) => p.kind !== "form");
    expect(
      errorsOf({ ...m, pages: noForm }).some((e) => e.includes("没有一个 kind=form 的 page")),
    ).toBe(true);
  });

  it("every type has at least one field, and the default locale is enabled", () => {
    const m = valid();
    const inquiry = { ...m.types[1]!, fields: [] };
    const errors = errorsOf({ ...m, types: [m.types[0]!, inquiry] });
    expect(errors.some((e) => e.includes("没有字段"))).toBe(true);

    const locales = { default: "en", enabled: ["zh"] };
    expect(errorsOf({ ...m, locales }).some((e) => e.includes("不在 enabled"))).toBe(true);
  });
});
