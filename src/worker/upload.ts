/**
 * 一次上传：多个文件，一个一个来（Worker 内存有限）。每个文件：守门（格式、大小、这道题收不收）→ 原件进 R2 →
 * 转 Markdown → 访谈者把文字放进工作区、把记录写进 files 表。守不过的文件不会半收：要么整条链走完，要么原样退回并说明原因。
 */
import { Effect } from "effect";
import { acceptsKind, MAX_FILE_BYTES, mimeOf, rejectReason, uniquePath } from "../shared/files.ts";
import { MAX_PROVIDED_BYTES, providedDir, providedQid, type Source } from "../shared/provided.ts";
import { MAX_FILES_DEFAULT, uploadDir, type Question } from "../shared/questions.ts";
import { convertFile } from "./convert.ts";
import type { Interviewer } from "./interviewer.ts";

export type FileResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly path?: string;
  readonly status?: "ok" | "unconverted";
  readonly note?: string;
  readonly size?: number;
};

/** 文件往哪放、收什么、收多少、多大：受访者在某道题上传 vs 提问方预置资料，是同一条流水线的两种目标。 */
export type Target = {
  readonly qid: string;
  readonly dir: string;
  readonly maxBytes: number;
  /** 还能收几个；null = 不限。 */
  readonly max: number | null;
  /** 收不收这个文件名：不收就是原因，收就是 null。 */
  readonly refuse: (name: string) => string | null;
};

export const questionTarget = (q: Extract<Question, { kind: "image" | "file" }>): Target => ({
  qid: q.id,
  dir: uploadDir(q.id),
  maxBytes: MAX_FILE_BYTES,
  max: q.max ?? MAX_FILES_DEFAULT,
  refuse: (name) => (acceptsKind(q.kind, name) ? null : "这道题只收图片"),
});

/** 提问方预置资料：文档、文本、图片都收，数量不限，单个文件的上限是平台的天花板（见 MAX_PROVIDED_BYTES）。 */
export const providedTarget = (source: Source): Target => ({
  qid: providedQid(source),
  dir: providedDir(source),
  maxBytes: MAX_PROVIDED_BYTES,
  max: null,
  refuse: () => null,
});

export const ingest = (
  env: Cloudflare.Env,
  stub: DurableObjectStub<Interviewer>,
  code: string,
  target: Target,
  files: ReadonlyArray<File>,
): Effect.Effect<FileResult[]> =>
  Effect.gen(function* () {
    const taken = new Set(yield* Effect.promise(() => stub.takenPaths()));
    const have = [...taken].filter((p) => p.startsWith(target.dir)).length;
    const room = target.max === null ? Infinity : target.max - have;
    const out: FileResult[] = [];
    let added = 0;
    for (const file of files) {
      const refuse =
        rejectReason(file.name, file.size, target.maxBytes) ?? target.refuse(file.name);
      if (refuse) {
        out.push({ name: file.name, ok: false, error: refuse });
        continue;
      }
      if (added >= room) {
        out.push({
          name: file.name,
          ok: false,
          error: `这里最多 ${target.max ?? 0} 个文件`,
        });
        continue;
      }
      const path = uniquePath(target.dir, file.name, taken);
      taken.add(path);
      const bytes = yield* Effect.promise(() => file.arrayBuffer());
      const r2Key = `${code}/${path}`;
      const mime = mimeOf(file.name, file.type);
      yield* Effect.promise(() =>
        env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: mime } }),
      );
      const conv = yield* convertFile(env.AI, file.name, bytes);
      const stored = yield* Effect.tryPromise(() =>
        stub.putFile(
          {
            path,
            qid: target.qid,
            name: file.name,
            size: file.size,
            mime,
            r2Key,
            status: conv.ok ? "ok" : "unconverted",
            ...(conv.ok ? { tokens: conv.tokens } : { note: conv.error }),
          },
          conv.ok ? conv.markdown : null,
        ),
      ).pipe(Effect.result);
      if (stored._tag === "Failure") {
        // 没存成：别留下孤立的原件，也别让整次上传变成一个空的 500——告诉受访者这个文件没收成，并留下原因
        yield* Effect.promise(() => env.FILES.delete(r2Key));
        const cause = (stored.failure as { cause?: unknown }).cause;
        out.push({
          name: file.name,
          ok: false,
          error: `保存失败：${cause instanceof Error ? cause.message : "原因不明"}`,
        });
        continue;
      }
      added += 1;
      out.push({
        name: file.name,
        ok: true,
        path,
        status: conv.ok ? "ok" : "unconverted",
        ...(conv.ok ? {} : { note: conv.error }),
        size: file.size,
      });
    }
    return out;
  });
