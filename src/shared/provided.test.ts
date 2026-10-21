import { describe, expect, it } from "vitest";
import { describeCall, pushActivity } from "./activity.ts";
import { providedListing, sourceOfQid } from "./provided.ts";
import { parseProvidedUrls } from "./provided-urls.ts";

const f = (qid: string, path: string, name = path, status: "ok" | "unconverted" = "ok") => ({
  qid,
  path,
  name,
  status,
});

describe("provided materials", () => {
  it("the source comes from where the file lives, nothing else", () => {
    expect(sourceOfQid("provided-respondent")).toBe("respondent");
    expect(sourceOfQid("provided-inquirer")).toBe("inquirer");
    expect(sourceOfQid("q3")).toBeNull();
  });
  it("tells the interviewer what each source may be used for", () => {
    const t = providedListing(
      [
        f("provided-respondent", "provided/respondent/a.pdf"),
        f("provided-inquirer", "provided/inquirer/b.md"),
        f("q1", "uploads/q1/x.pdf"),
      ],
      [{ url: "https://c.example", source: "respondent" }],
      (p) => `/${p}.md`,
    );
    expect(t).toContain("【受访者提供的】");
    expect(t).toContain("/provided/respondent/a.pdf.md");
    expect(t).toContain("【提问方做的调研】");
    expect(t).toContain("不能当依据");
    expect(t).toContain("https://c.example");
    expect(t).not.toContain("uploads/q1");
  });
  it("nothing provided = nothing said", () => {
    expect(providedListing([f("q1", "uploads/q1/x.pdf")], [], (p) => p)).toBe("");
  });
  it("a file that did not convert is listed as unreadable", () => {
    expect(
      providedListing(
        [f("provided-respondent", "provided/respondent/a.pdf", "a.pdf", "unconverted")],
        [],
        (p) => p,
      ),
    ).toContain("读不到内容");
  });
});

describe("activity", () => {
  it("says what the interviewer is doing in the customer's words", () => {
    expect(describeCall("read", { path: "/provided/respondent/画册.pdf.md" })).toBe(
      "正在读「画册.pdf」",
    );
    expect(describeCall("fetch_page", { url: "https://www.huarui-laser.com/a" })).toBe(
      "正在打开网页 www.huarui-laser.com",
    );
    expect(describeCall("search_web", { query: "激光切割机 沙特 认证" })).toContain("激光切割机");
    expect(describeCall("write", { path: "/NOTES.md" })).toContain("笔记");
  });
  it("ending calls are not activity", () => {
    expect(describeCall("ask_round", {})).toBeNull();
    expect(describeCall("finish_interview", {})).toBeNull();
  });
  it("keeps the latest few, merging repeats", () => {
    let l: ReadonlyArray<string> = [];
    for (const s of ["a", "a", "b", "c", "d", "e", "f", "g"]) l = pushActivity(l, s);
    expect(l).toEqual(["b", "c", "d", "e", "f", "g"]);
  });
});

describe("preset urls", () => {
  it("each must be a public http(s) address with a valid source", () => {
    expect(parseProvidedUrls([{ url: "https://example.com/a", source: "respondent" }])).toEqual({
      ok: true,
      urls: [{ url: "https://example.com/a", source: "respondent" }],
    });
    expect(parseProvidedUrls([{ url: "http://localhost:3000", source: "respondent" }]).ok).toBe(
      false,
    );
    expect(parseProvidedUrls([{ url: "https://example.com", source: "me" }]).ok).toBe(false);
    expect(parseProvidedUrls(undefined)).toEqual({ ok: true, urls: [] });
  });
  it("at most 20", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      url: `https://a${i}.example.com`,
      source: "inquirer",
    }));
    expect(parseProvidedUrls(many).ok).toBe(false);
  });
});
