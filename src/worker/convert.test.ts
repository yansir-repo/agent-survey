import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { convertFile } from "./convert.ts";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const run = (name: string, text: string) => convertFile(undefined, name, bytes(text));

describe("convertFile without the Workers AI binding (local development)", () => {
  it.effect("reads plain text and markdown as they are", () =>
    Effect.gen(function* () {
      expect(yield* run("a.txt", "你好")).toMatchObject({ ok: true, markdown: "你好" });
      expect(yield* run("a.md", "# 标题")).toMatchObject({ ok: true, markdown: "# 标题" });
    }),
  );

  it.effect(
    "reads a CSV itself, as UTF-8 (toMarkdown reads CSV as Latin-1 and garbles Chinese headers)",
    () =>
      Effect.gen(function* () {
        const r = yield* run("型号.csv", "型号,材质\nA106,304不锈钢\n");
        expect(r).toMatchObject({ ok: true });
        expect(r.ok ? r.markdown : "").toContain("型号,材质");
        expect(r.ok ? r.markdown : "").toContain("304不锈钢");
      }),
  );

  it.effect("says plainly that it cannot parse the rest here, instead of pretending", () =>
    Effect.gen(function* () {
      const r = yield* run("a.pdf", "x");
      expect(r).toMatchObject({ ok: false });
      expect(r.ok ? "" : r.error).toContain("Workers AI");
    }),
  );
});
