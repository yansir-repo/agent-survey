/**
 * 访谈登记，一个事实一处：D1 的 `interviews`（code → key、背景）。访谈自己的内容在它的 Durable Object 里。
 * 客户的地址是 `/i/<code>.<key>`：key 就是门；对错一律同一种 404，不泄露哪个 code 存在。
 */
import { Data, Effect } from "effect";
import { nowSeconds } from "./clock.ts";
import { Db, num, str } from "./db.ts";

export class InterviewExists extends Data.TaggedError("InterviewExists")<{
  readonly code: string;
}> {}
export class InterviewNotFound extends Data.TaggedError("InterviewNotFound")<{
  readonly what: string;
}> {}
export class InterviewInvalid extends Data.TaggedError("InterviewInvalid")<{
  readonly message: string;
}> {}

/** 访谈 code：字母数字横线（会进地址和 DO 名字），统一小写。 */
export const CODE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const normalizeCode = (code: string): string => code.trim().toLowerCase();

export const interviewPath = (code: string, key: string): string => `/i/${code}.${key}`;

/** `/i/<code>.<16 hex>` 以及它下面的 /api/…。 */
export const parseInterviewPath = (
  pathname: string,
): { code: string; key: string; rest: string } | null => {
  const m = /^\/i\/([a-z0-9][a-z0-9-]{1,38})\.([0-9a-f]{16})(\/.*)?$/.exec(pathname);
  return m ? { code: m[1]!, key: m[2]!, rest: m[3] ?? "/" } : null;
};

const randomKey = Effect.sync(() =>
  [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""),
);

/** 常量时间比较：key 不靠比较耗时泄露。 */
export const sameSecret = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export type Interview = {
  readonly code: string;
  readonly key: string;
  readonly brief: string;
  readonly profile: string;
  readonly mission: string;
  readonly createdAt: number;
};
const rowOf = (r: Readonly<Record<string, unknown>>): Interview => ({
  code: str(r, "code"),
  key: str(r, "key"),
  brief: str(r, "brief"),
  profile: str(r, "profile"),
  mission: str(r, "mission"),
  createdAt: num(r, "created_at"),
});

export const create = (rawCode: string, brief: string, profile: string, mission: string) =>
  Effect.gen(function* () {
    const code = normalizeCode(rawCode);
    if (!CODE_RE.test(code))
      return yield* new InterviewInvalid({
        message: "code 只能用小写字母、数字、横线（2–39 个字符）",
      });
    if (brief.length > 8000)
      return yield* new InterviewInvalid({ message: "背景太长了（最多 8000 个字）" });
    const db = yield* Db;
    if ((yield* db.first("SELECT code FROM interviews WHERE code = ?", [code])) !== undefined)
      return yield* new InterviewExists({ code });
    const key = yield* randomKey;
    yield* db.run(
      "INSERT INTO interviews (code, key, brief, profile, mission, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [code, key, brief, profile, mission, yield* nowSeconds],
    );
    return { code, key, brief, profile, mission, createdAt: yield* nowSeconds } satisfies Interview;
  });

export const find = (code: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* db.first("SELECT * FROM interviews WHERE code = ?", [normalizeCode(code)]);
    return row ? rowOf(row) : null;
  });

/** 客户这一侧的门：code + key 都对才算。 */
export const open = (code: string, key: string) =>
  Effect.map(find(code), (i) => (i !== null && sameSecret(i.key, key) ? i : null));

export const list = Effect.gen(function* () {
  const db = yield* Db;
  return (yield* db.all("SELECT * FROM interviews ORDER BY created_at DESC")).map(rowOf);
});

/** 换 key：旧链接立刻失效。 */
export const rotate = (code: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const found = yield* find(code);
    if (!found) return yield* new InterviewNotFound({ what: code });
    const key = yield* randomKey;
    yield* db.run("UPDATE interviews SET key = ?, rotated_at = ? WHERE code = ?", [
      key,
      yield* nowSeconds,
      found.code,
    ]);
    return { ...found, key } satisfies Interview;
  });
