/**
 * The Worker. One deployment serves every interview: an interview is a row in D1 plus its own Durable Object.
 *
 *   GET    /i/<code>.<key>                      the interview page (only when code + key match)
 *   GET    /i/<code>.<key>/api/state            what the client renders (polled)
 *   PUT    /i/<code>.<key>/api/answers/<qid>    autosave one answer (or "later")
 *   POST   /i/<code>.<key>/api/rounds/<id>/submit
 *   POST   /i/<code>.<key>/api/files?qid=       upload (multipart, several files, drag & drop)
 *   DELETE /i/<code>.<key>/api/files?path=
 *   POST   /i/<code>.<key>/api/resume           the agent's turn broke: try again
 *   /admin/*  the inquirer's side (Bearer ADMIN_TOKEN) — create / list / result / rotate / delete; the endpoint list lives in
 *             src/shared/guide.ts (served as GET /admin/guide and the public /llms.txt), not here.
 */
import { env } from "cloudflare:workers";
import { Cause, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { DbLive, type D1Like } from "./db.ts";
import { DOC_EXT, IMAGE_EXT, TEXT_EXT } from "../shared/files.ts";
import { DEFAULT_MODEL, MODELS, resolveModel } from "../shared/models.ts";
import { markdownPath } from "../shared/files.ts";
import { guideText } from "../shared/guide.ts";
import { isSource, sourceOfQid } from "../shared/provided.ts";
import { parseProvidedUrls } from "../shared/provided-urls.ts";
import { NOTES_PATH } from "../shared/prompt.ts";
import { DEFAULT_TEMPLATE, TEMPLATES, resolveTemplate } from "../shared/templates.ts";
import { bundleMarkdown } from "../shared/bundle.ts";
import type { ResultBundle } from "./interview.ts";
import { ingest, providedTarget, questionTarget } from "./upload.ts";
import {
  InterviewExists,
  InterviewRetired,
  InterviewInvalid,
  InterviewNotFound,
  create,
  interviewPath,
  list,
  normalizeCode,
  open,
  parseInterviewPath,
  find,
  retire,
  rotate,
  sameSecret,
} from "./registry.ts";
export { Interviewer } from "./interviewer.ts";

const NOT_FOUND = () =>
  HttpServerResponse.text("没有这个页面", { status: 404, headers: { "x-robots-tag": "noindex" } });
const PRIVATE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;
const json = (data: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(data, { status, headers: PRIVATE });
const stubOf = (code: string) => env.Interviewer.get(env.Interviewer.idFromName(code));
const PREVIEW_CHARS = 150_000;
const origin = () => env.PUBLIC_URL.replace(/\/$/, "");

/** A Durable Object RPC call as an effect (`await` unwraps the stub's pipelined promise types). */
const rpc = <T>(call: () => Promise<T>): Effect.Effect<T> => Effect.promise(call);

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const readJson = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const text = yield* request.text;
    if (text.length > 200_000) return null;
    return yield* decodeJson(text).pipe(Effect.orElseSucceed(() => null));
  });
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const asRecord = (x: unknown): Record<string, unknown> =>
  typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};

// ---- the client's side: the key is the gate ----

const clientRoute = (db: D1Like) =>
  HttpRouter.add(
    "*",
    "/i/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://x");
      const parts = parseInterviewPath(url.pathname);
      if (!parts) return NOT_FOUND();
      const found = yield* open(parts.code, parts.key).pipe(Effect.provide(DbLive(db)));
      if (found === null) return NOT_FOUND();
      const stub = stubOf(parts.code);
      const { rest } = parts;
      const method = request.method;

      if ((rest === "/" || rest === "") && method === "GET") {
        const shell = yield* Effect.promise(() =>
          env.ASSETS.fetch(new Request(`http://${request.headers["host"] ?? "localhost"}/`)),
        );
        const html = yield* Effect.promise(() => shell.text());
        return HttpServerResponse.text(html, {
          contentType: "text/html; charset=utf-8",
          headers: PRIVATE,
        });
      }
      if (rest === "/api/state" && method === "GET") return json(yield* rpc(() => stub.view()));

      const answer = /^\/api\/answers\/([A-Za-z0-9_-]{1,40})$/.exec(rest);
      if (answer && method === "PUT") {
        const body = asRecord(yield* readJson(request));
        const r = yield* rpc(() =>
          stub.saveAnswer(answer[1]!, body["value"] ?? null, body["skipped"] === true),
        );
        return json(r, r.ok ? 200 : 422);
      }
      const note = /^\/api\/rounds\/([a-z0-9]{1,12})\/note$/.exec(rest);
      if (note && method === "PUT") {
        const body = asRecord(yield* readJson(request));
        const r = yield* rpc(() => stub.saveNote(note[1]!, str(body["text"])));
        return json(r, r.ok ? 200 : 422);
      }
      const submit = /^\/api\/rounds\/([a-z0-9]{1,12})\/submit$/.exec(rest);
      if (submit && method === "POST") {
        const r = yield* rpc(() => stub.submit(submit[1]!));
        return json(r, r.ok ? 200 : 422);
      }
      // 受访者看得到提问方预置的资料（转成文字的那份）：只限 provided/ 下的文件
      if (rest === "/api/provided/file" && method === "GET") {
        const path = url.searchParams.get("path") ?? "";
        const view = yield* rpc(() => stub.view());
        const f = view.files.find((x) => x.path === path && sourceOfQid(x.qid) !== null);
        if (!f) return json({ ok: false, error: "没有这份资料" }, 404);
        const text = yield* rpc(() => stub.readWorkspace(`/${markdownPath(f.path)}`));
        // 页面上读的是节选（几 MB 的文档塞进浏览器会卡死）；访谈者读的是完整内容
        const whole = text ?? "";
        return json({
          ok: true,
          name: f.name,
          text: whole.slice(0, PREVIEW_CHARS),
          truncated: whole.length > PREVIEW_CHARS,
          status: f.status,
        });
      }
      // 受访者看得到 agent 的工作笔记（它眼里的“我对你的理解”），也可以下载
      if (rest === "/api/notes" && method === "GET") {
        const text = (yield* rpc(() => stub.readWorkspace(NOTES_PATH))) ?? "";
        return url.searchParams.has("download")
          ? HttpServerResponse.text(text, {
              contentType: "text/markdown; charset=utf-8",
              headers: { "content-disposition": `attachment; filename="NOTES-${parts.code}.md"` },
            })
          : json({ ok: true, text });
      }
      if (rest === "/api/resume" && method === "POST") {
        const r = yield* rpc(() => stub.resume());
        return json(r, r.ok ? 200 : 422);
      }
      if (rest === "/api/files" && method === "POST") {
        const qid = url.searchParams.get("qid") ?? "";
        const view = yield* rpc(() => stub.view());
        const q = view.round?.questions.find((x) => x.id === qid);
        if (!q || (q.kind !== "image" && q.kind !== "file"))
          return json({ ok: false, error: "这道题不收文件" }, 422);
        const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        const form = yield* Effect.promise(() => web.formData()).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (form === null) return json({ ok: false, error: "上传的内容读不出来" }, 400);
        const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
        if (files.length === 0) return json({ ok: false, error: "没有收到文件" }, 400);
        const results = yield* ingest(env, stub, parts.code, questionTarget(q), files);
        return json({ ok: true, results });
      }
      if (rest === "/api/files" && method === "DELETE") {
        const path = url.searchParams.get("path") ?? "";
        const r = yield* rpc(() => stub.removeFile(path));
        if (!r.ok) return json(r, 404);
        yield* Effect.promise(() => env.FILES.delete(r.r2Key ?? ""));
        return json({ ok: true });
      }
      return NOT_FOUND();
    }),
  );

// ---- the operator's side: a bearer token ----

const adminAllowed = (request: HttpServerRequest.HttpServerRequest): boolean => {
  const token = env.ADMIN_TOKEN ?? "";
  const given = /^Bearer (.+)$/.exec(request.headers["authorization"] ?? "")?.[1] ?? "";
  return token.length >= 16 && token !== "none" && sameSecret(token, given);
};

const adminRoute = (db: D1Like) =>
  HttpRouter.add(
    "*",
    "/admin/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!adminAllowed(request)) return HttpServerResponse.text("需要提问方凭证", { status: 401 });
      const url = new URL(request.url, "http://x");
      const path = url.pathname.replace(/\/$/, "");
      const method = request.method;
      const provide = Effect.provide(DbLive(db));

      if (path === "/admin/interviews" && method === "POST") {
        const body = asRecord(yield* readJson(request));
        // 选一个模板（默认 DEFAULT_TEMPLATE）、整段覆盖目标（goal）、在模板后追加（append），以及覆盖它的验收条款、节奏、能力……
        // 解析后的目标文本和快照一起存进访谈：之后改模板不影响进行中的访谈。
        const resolved = resolveTemplate(body);
        if (!resolved.ok) return json({ ok: false, error: resolved.error }, 422);
        const model = resolveModel(str(body["model"]));
        if (!model.ok) return json({ ok: false, error: model.error }, 422);
        const made = yield* create(
          str(body["code"]),
          str(body["brief"]),
          resolved.label,
          resolved.goal,
          model.name,
        ).pipe(provide, Effect.result);
        if (made._tag === "Failure") {
          const e = made.failure;
          if (e instanceof InterviewExists) {
            const have = yield* find(e.code).pipe(provide);
            return json(
              {
                ok: false,
                error: `${e.code} 已经存在（响应里的 existing.url 就是它的链接；要重新来过，换一个 code）`,
                ...(have
                  ? {
                      existing: {
                        code: have.code,
                        url: `${origin()}${interviewPath(have.code, have.key)}`,
                      },
                    }
                  : {}),
              },
              409,
            );
          }
          return e instanceof InterviewRetired
            ? json(
                { ok: false, retired: true, error: `${e.code} 曾经删除过，code 永久作废，换一个` },
                409,
              )
            : e instanceof InterviewInvalid
              ? json({ ok: false, error: e.message }, 422)
              : yield* Effect.die(e);
        }
        const i = made.success;
        const pre = parseProvidedUrls(body["urls"]);
        if (!pre.ok) return json({ ok: false, error: pre.error }, 422);
        if (pre.urls.length > 0) yield* rpc(() => stubOf(i.code).addUrls(pre.urls));
        // start: false = 先建好，等 materials 放完再 POST …/start（命令行的 --material 就是这么走的）
        // 模板快照（验收条款、节奏、能力、语言、回调……）也一起存进 DO。
        const spec = JSON.stringify(resolved.spec);
        yield* rpc(() =>
          stubOf(i.code).begin(i.brief, i.goal, i.model, body["start"] !== false, spec),
        );
        return json(
          {
            ok: true,
            code: i.code,
            template: i.template,
            spec: resolved.spec,
            model: i.model,
            url: `${origin()}${interviewPath(i.code, i.key)}`,
          },
          201,
        );
      }
      if (path === "/admin/guide" && method === "GET")
        return HttpServerResponse.text(guide(url.origin), {
          contentType: "text/markdown; charset=utf-8",
        });
      if (path === "/admin/models" && method === "GET")
        return json({
          models: Object.entries(MODELS).map(([name, m]) => ({
            name,
            title: m.title,
            provider: m.provider,
            available:
              m.provider === "deepseek"
                ? env.DEEPSEEK_API_KEY !== "none"
                : env.AIHUBMIX_API_KEY !== "none",
          })),
        });
      if (path === "/admin/templates" && method === "GET")
        return json({
          default: DEFAULT_TEMPLATE,
          templates: Object.entries(TEMPLATES).map(([name, t]) => ({
            name,
            title: t.title,
            version: t.version,
            criteria: t.criteria,
            respondent: t.respondent ?? "",
            chars: t.goal.length,
          })),
        });
      if (path === "/admin/interviews" && method === "GET") {
        const all = yield* list.pipe(provide);
        const rows = yield* Effect.forEach(all, (i) =>
          rpc(() => stubOf(i.code).view()).pipe(
            Effect.map((v) => ({
              code: i.code,
              url: `${origin()}${interviewPath(i.code, i.key)}`,
              phase: v.phase,
              rounds: v.history.length,
              deferred: v.deferred.length,
              files: v.files.length,
            })),
          ),
        );
        return json({ interviews: rows });
      }
      const one =
        /^\/admin\/interviews\/([a-z0-9-]+)(\/rotate|\/file|\/result|\/materials|\/start)?$/.exec(
          path,
        );
      if (one) {
        const code = normalizeCode(one[1]!);
        if (one[2] === "/rotate" && method === "POST") {
          const r = yield* rotate(code).pipe(provide, Effect.result);
          return r._tag === "Failure"
            ? r.failure instanceof InterviewNotFound
              ? json({ ok: false, error: "没有这个访谈" }, 404)
              : yield* Effect.die(r.failure)
            : json({ ok: true, url: `${origin()}${interviewPath(code, r.success.key)}` });
        }
        const exists = yield* list.pipe(
          provide,
          Effect.map((all) => all.find((i) => i.code === code)),
        );
        if (!exists) return json({ ok: false, error: "没有这个访谈" }, 404);
        if (!one[2] && method === "DELETE") {
          const keys = yield* rpc(() => stubOf(code).wipe());
          if (keys.length > 0) yield* Effect.promise(() => env.FILES.delete(keys)); // R2 拒绝空数组
          yield* retire(code).pipe(provide, Effect.orDie);
          return json({ ok: true, removedFiles: keys.length });
        }
        if (one[2] === "/start" && method === "POST") {
          yield* rpc(() => stubOf(code).start());
          return json({ ok: true });
        }
        if (one[2] === "/materials" && method === "POST") {
          const ctype = request.headers["content-type"] ?? "";
          if (ctype.includes("application/json")) {
            const body = asRecord(yield* readJson(request));
            const src = str(body["source"]);
            if (!isSource(src))
              return json({ ok: false, error: "source 要写 respondent 或 inquirer" }, 422);
            const parsed = parseProvidedUrls(
              (Array.isArray(body["urls"]) ? body["urls"] : []).map((u) => ({
                url: u,
                source: src,
              })),
            );
            if (!parsed.ok) return json({ ok: false, error: parsed.error }, 422);
            const total = yield* rpc(() => stubOf(code).addUrls(parsed.urls));
            return json({ ok: true, urls: total });
          }
          const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
          const form = yield* Effect.promise(() => web.formData()).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (form === null) return json({ ok: false, error: "上传的内容读不出来" }, 400);
          const src = form.get("source");
          if (!isSource(src))
            return json({ ok: false, error: "source 要写 respondent 或 inquirer" }, 422);
          const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
          if (files.length === 0) return json({ ok: false, error: "没有收到文件" }, 400);
          const results = yield* ingest(env, stubOf(code), code, providedTarget(src), files);
          return json({ ok: results.some((r) => r.ok), results });
        }
        if (one[2] === "/result" && method === "GET") {
          const out = JSON.parse(yield* rpc(() => stubOf(code).result())) as ResultBundle;
          // ?format=md：同一份记录的人读版，由记录机械渲染
          return url.searchParams.get("format") === "md"
            ? HttpServerResponse.text(bundleMarkdown(out), {
                contentType: "text/markdown; charset=utf-8",
              })
            : json({ ok: true, ...out });
        }
        if (one[2] === "/file" && method === "GET") {
          const text = yield* rpc(() =>
            stubOf(code).readWorkspace(url.searchParams.get("path") ?? ""),
          );
          return text === null
            ? json({ ok: false, error: "没有这个文件" }, 404)
            : HttpServerResponse.text(text, { contentType: "text/markdown; charset=utf-8" });
        }
        if (!one[2] && method === "GET") {
          const snap = JSON.parse(yield* rpc(() => stubOf(code).snapshot())) as Record<
            string,
            unknown
          >;
          return json({ ...snap, url: `${origin()}${interviewPath(code, exists.key)}` });
        }
      }
      if (path === "/admin/formats" && method === "GET") {
        const supported = env.AI
          ? yield* Effect.promise(() => env.AI!.toMarkdown().supported())
          : [];
        const remote = new Set(supported.map((s) => s.extension.replace(/^\./, "").toLowerCase()));
        const ours = [...DOC_EXT, ...IMAGE_EXT];
        return json({
          aiAvailable: Boolean(env.AI),
          weAcceptButAiDoesNot: env.AI ? ours.filter((e) => !remote.has(e)) : [],
          aiSupportsButWeDoNot: env.AI
            ? [...remote].filter(
                (e) =>
                  !(ours as ReadonlyArray<string>).includes(e) &&
                  !(TEXT_EXT as ReadonlyArray<string>).includes(e),
              )
            : [],
        });
      }
      return NOT_FOUND();
    }),
  );

/** One web handler per request: a Workers isolate serves requests concurrently, and I/O created for one request cannot be awaited by another. */
const buildHandler = (db: D1Like) =>
  HttpRouter.toWebHandler(Layer.mergeAll(clientRoute(db), adminRoute(db)), {
    disableLogger: true,
    // A defect in a route is the server's fault, never the customer's: answer in JSON (the page can show it) instead of an empty 500.
    middleware: (app) =>
      app.pipe(
        Effect.catchCause((cause) =>
          // 留一条日志（`node scripts/logs.ts`），受访者那边只给一句话——细节不该给受访者，但也不该丢
          Effect.sync(() =>
            console.error("route defect:", Cause.pretty(cause).slice(0, 1500)),
          ).pipe(Effect.as(json({ ok: false, error: "服务出了点问题，请稍后重试" }, 500))),
        ),
      ),
  });

const guide = (origin: string): string =>
  guideText({
    origin,
    templates: Object.entries(TEMPLATES).map(([name, t]) => ({
      name,
      title: t.title,
      version: t.version,
    })),
    defaultTemplate: DEFAULT_TEMPLATE,
    models: Object.entries(MODELS).map(([name, m]) => ({
      name,
      title: m.title,
      available:
        m.provider === "deepseek"
          ? env.DEEPSEEK_API_KEY !== "none"
          : env.AIHUBMIX_API_KEY !== "none",
    })),
    defaultModel: DEFAULT_MODEL,
  });

/** 首页：没有入口、不列任何访谈——访谈只能从提问方发的专属链接进。 */
const HOME = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>需求访谈</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#23201b;font:16px/1.7 -apple-system,"PingFang SC",sans-serif;text-align:center;padding:24px}h1{font-size:24px;margin:0 0 8px}p{color:#7a7468;margin:0}</style></head>
<body><main><h1>需求访谈</h1><p>请从我们发给你的专属链接进入。<br>没有收到链接？联系你的对接人。</p></main></body></html>`;

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/" && request.method === "GET")
      return Promise.resolve(
        new Response(HOME, {
          headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
        }),
      );
    // 给 agent 的说明书：不含任何凭证或受访者信息，所以公开
    if (pathname === "/llms.txt" && request.method === "GET")
      return Promise.resolve(
        new Response(guide(new URL(request.url).origin), {
          headers: { "content-type": "text/markdown; charset=utf-8", "x-robots-tag": "noindex" },
        }),
      );
    if (!pathname.startsWith("/i/") && !pathname.startsWith("/admin/"))
      return Promise.resolve(new Response("Not found", { status: 404 }));
    const web = buildHandler(env.DB);
    // Read the body out before disposing: the response streams from the runtime being disposed.
    return web.handler(request).then((response) =>
      response.arrayBuffer().then((body) => {
        void web.dispose();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
