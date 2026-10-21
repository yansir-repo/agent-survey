import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 引擎不认识任何调用它的系统：领域词只允许出现在 templates/ 里。 */
const FORBIDDEN = [
  "米站",
  "zeroy",
  "建站",
  "交底",
  "开发者",
  "CONTEXT",
  "facts.json",
  "model.json",
  "客户",
  "运营",
  "我方",
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

describe("the engine is independent of any caller", () => {
  it("src/ contains no domain words", () => {
    const hits = files("src")
      .filter((f) => !f.endsWith("independence.test.ts"))
      .flatMap((f) => {
        const text = readFileSync(f, "utf8").replaceAll("客户端", "");
        return FORBIDDEN.filter((w) => text.includes(w)).map((w) => `${f}: ${w}`);
      });
    expect(hits).toEqual([]);
  });
});
