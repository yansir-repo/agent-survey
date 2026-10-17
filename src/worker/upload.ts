/**
 * 一次上传：多个文件，一个一个来（Worker 内存有限）。每个文件：守门（格式、大小、这道题收不收）→ 原件进 R2 →
 * 转 Markdown → 访谈者把文字放进工作区、把记录写进 files 表。守不过的文件不会半收：要么整条链走完，要么原样退回并说明原因。
 */
import { Effect } from "effect";
import { acceptsKind, rejectReason, uniquePath } from "../shared/files.ts";
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

export const ingest = (
  env: Cloudflare.Env,
  stub: DurableObjectStub<Interviewer>,
  code: string,
  q: Extract<Question, { kind: "image" | "file" }>,
  files: ReadonlyArray<File>,
): Effect.Effect<FileResult[]> =>
  Effect.gen(function* () {
    const taken = new Set(yield* Effect.promise(() => stub.takenPaths()));
    const have = [...taken].filter((p) => p.startsWith(uploadDir(q.id))).length;
    const room = (q.max ?? MAX_FILES_DEFAULT) - have;
    const out: FileResult[] = [];
    let added = 0;
    for (const file of files) {
      const refuse =
        rejectReason(file.name, file.size) ??
        (acceptsKind(q.kind, file.name) ? null : "这道题只收图片");
      if (refuse) {
        out.push({ name: file.name, ok: false, error: refuse });
        continue;
      }
      if (added >= room) {
        out.push({
          name: file.name,
          ok: false,
          error: `这道题最多 ${q.max ?? MAX_FILES_DEFAULT} 个文件`,
        });
        continue;
      }
      const path = uniquePath(uploadDir(q.id), file.name, taken);
      taken.add(path);
      const bytes = yield* Effect.promise(() => file.arrayBuffer());
      const r2Key = `${code}/${path}`;
      const mime = file.type || "application/octet-stream";
      yield* Effect.promise(() =>
        env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: mime } }),
      );
      const conv = yield* convertFile(env.AI, file.name, bytes);
      yield* Effect.promise(() =>
        stub.putFile(
          {
            path,
            qid: q.id,
            name: file.name,
            size: file.size,
            mime,
            r2Key,
            status: conv.ok ? "ok" : "unconverted",
            ...(conv.ok ? { tokens: conv.tokens } : { note: conv.error }),
          },
          conv.ok ? conv.markdown : null,
        ),
      );
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
