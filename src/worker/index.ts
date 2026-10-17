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
 *   POST   /admin/interviews                    create one → the client link       (Authorization: Bearer <ADMIN_TOKEN>)
 *   GET    /admin/interviews[/<code>]           list / everything about one
 *   POST   /admin/interviews/<code>/rotate      new key, old link dies
 *   GET    /admin/interviews/<code>/file?path=  read a workspace file (e.g. /CONTEXT.md)
 *   GET    /admin/formats                       what toMarkdown supports now vs what we accept
 */
import { env } from "cloudflare:workers";
import { Cause, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { DbLive, type D1Like } from "./db.ts";
import { DOC_EXT, IMAGE_EXT, TEXT_EXT } from "../shared/files.ts";
import { DEFAULT_PROFILE, PROFILES, resolveMission } from "../shared/profiles.ts";
import { ingest } from "./upload.ts";
import {
  InterviewExists,
  InterviewInvalid,
  InterviewNotFound,
  create,
  interviewPath,
  list,
  normalizeCode,
  open,
  parseInterviewPath,
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
        const results = yield* ingest(env, stub, parts.code, q, files);
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
      if (!adminAllowed(request)) return HttpServerResponse.text("需要运营凭证", { status: 401 });
      const url = new URL(request.url, "http://x");
      const path = url.pathname.replace(/\/$/, "");
      const method = request.method;
      const provide = Effect.provide(DbLive(db));

      if (path === "/admin/interviews" && method === "POST") {
        const body = asRecord(yield* readJson(request));
        // 任务层：选一个预设（默认 DEFAULT_PROFILE）、整段覆盖（mission）、或在预设后追加（append）；解析后的文本存进访谈（快照）
        const resolved = resolveMission({
          profile: str(body["profile"]),
          mission: str(body["mission"]),
          append: str(body["append"]),
        });
        if (!resolved.ok) return json({ ok: false, error: resolved.error }, 422);
        const made = yield* create(
          str(body["code"]),
          str(body["brief"]),
          resolved.profile,
          resolved.mission,
        ).pipe(provide, Effect.result);
        if (made._tag === "Failure") {
          const e = made.failure;
          return e instanceof InterviewExists
            ? json({ ok: false, error: `${e.code} 已经存在` }, 409)
            : e instanceof InterviewInvalid
              ? json({ ok: false, error: e.message }, 422)
              : yield* Effect.die(e);
        }
        const i = made.success;
        yield* rpc(() => stubOf(i.code).begin(i.brief, i.mission));
        return json(
          {
            ok: true,
            code: i.code,
            profile: i.profile,
            url: `${origin()}${interviewPath(i.code, i.key)}`,
          },
          201,
        );
      }
      if (path === "/admin/profiles" && method === "GET")
        return json({
          default: DEFAULT_PROFILE,
          profiles: Object.entries(PROFILES).map(([name, p]) => ({
            name,
            title: p.title,
            chars: p.mission.length,
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
      const one = /^\/admin\/interviews\/([a-z0-9-]+)(\/rotate|\/file)?$/.exec(path);
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
          // 留一条日志（`node scripts/logs.ts`），客户那边只给一句话——细节不该给客户，但也不该丢
          Effect.sync(() =>
            console.error("route defect:", Cause.pretty(cause).slice(0, 1500)),
          ).pipe(Effect.as(json({ ok: false, error: "服务出了点问题，请稍后重试" }, 500))),
        ),
      ),
  });

/** 首页：没有入口、不列任何访谈——访谈只能从运营发的专属链接进。 */
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
