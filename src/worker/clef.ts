/**
 * clef-flash (Cloudflare Workers AI's decision model): closed-option questions answered as probability
 * distributions, over a `state` we send. It does not write text. Decoding is strict: a choice must be
 * one of the criteria we sent, the distribution must cover exactly those options and sum to one, and
 * the stated choice must be its maximum. Anything else is not an answer.
 */
import { Context, Data, Effect, Layer } from "effect";

export const CLEF_MODEL = "clef-flash";
const CLEF_ID = "@cf/cloudflare/clef-flash";
/** clef answers 1–64 questions per call; more are split over calls that share the state. */
export const MAX_QUESTIONS = 64;

export class ClefError extends Data.TaggedError("ClefError")<{ readonly message: string }> {}

export type ChoiceQuestion = {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
};
export type ClefRequest = {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
};
export type ClefChoice = {
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
};
export type ClefAnswers = {
  readonly model: string;
  readonly answers: Readonly<Record<string, ClefChoice>>;
};

/** A yes/no question answered as one P(yes); used where the answer is a subset (the board filter). */
export type NoulQuestion = { readonly type: "noul"; readonly instructions: string };
export type NoulRequest = {
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, NoulQuestion>>;
};
/** Readable answers only (an unreadable one is absent), plus the provider's reported input tokens. */
export type NoulAnswers = {
  readonly model: string;
  readonly answers: Readonly<Record<string, number>>;
  readonly inputTokens: number;
};

export class Clef extends Context.Service<
  Clef,
  {
    readonly ask: (request: ClefRequest) => Effect.Effect<ClefAnswers, ClefError>;
    readonly noul: (request: NoulRequest) => Effect.Effect<NoulAnswers, ClefError>;
  }
>()("grill-me/Clef") {}

type Json = Readonly<Record<string, unknown>>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const probability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export const decodeChoice = (
  answer: unknown,
  criteria: Readonly<Record<string, string>>,
): ClefChoice | undefined => {
  if (!isObject(answer) || answer.type !== "choice" || typeof answer.choice !== "string")
    return undefined;
  if (
    !Object.hasOwn(criteria, answer.choice) ||
    !probability(answer.confidence) ||
    !isObject(answer.probabilities)
  )
    return undefined;
  const raw = answer.probabilities;
  const expected = Object.keys(criteria);
  const values = Object.values(raw);
  if (Object.keys(raw).length !== expected.length || expected.some((id) => !Object.hasOwn(raw, id)))
    return undefined;
  if (!values.every(probability)) return undefined;
  const probabilities: Record<string, number> = {};
  for (const id of expected) probabilities[id] = raw[id] as number;
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  const max = Math.max(...(values as number[]));
  if (Math.abs(sum - 1) > 0.02 || (probabilities[answer.choice] ?? -1) < max - 1e-6)
    return undefined;
  return { choice: answer.choice, confidence: answer.confidence, probabilities };
};

const validModel = (body: Json): boolean =>
  typeof body.model === "string" && /^clef-[a-z0-9._-]{1,64}$/i.test(body.model);

/** Decode every question; a question whose answer is unreadable is simply absent. */
export const decodeAnswers = (body: unknown, request: ClefRequest): ClefAnswers | undefined => {
  if (!isObject(body) || !validModel(body) || !isObject(body.answers)) return undefined;
  const raw = body.answers;
  const answers: Record<string, ClefChoice> = {};
  for (const [key, q] of Object.entries(request.questions)) {
    const a = decodeChoice(raw[key], q.criteria);
    if (a) answers[key] = a;
  }
  return { model: body.model as string, answers };
};

/** A `noul` answer is one probability and nothing else. */
export const decodeNoul = (answer: unknown): number | undefined =>
  isObject(answer) && answer.type === "noul" && probability(answer.noul) ? answer.noul : undefined;

export const decodeNoulAnswers = (body: unknown, request: NoulRequest): NoulAnswers | undefined => {
  if (!isObject(body) || !validModel(body) || !isObject(body.answers)) return undefined;
  const raw = body.answers;
  const answers: Record<string, number> = {};
  for (const key of Object.keys(request.questions)) {
    const p = decodeNoul(raw[key]);
    if (p !== undefined) answers[key] = p;
  }
  const tokens = isObject(body.usage) ? body.usage.input_tokens : undefined;
  return {
    model: body.model as string,
    answers,
    inputTokens: typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : 0,
  };
};

/** The Workers AI binding, narrowed to the one call made here (clef is not in workers-types' model table). */
export type ClefBinding = { readonly run: (model: string, input: object) => Promise<unknown> };

const run = <A>(
  ai: ClefBinding | undefined,
  request: object,
  decode: (body: unknown) => A | undefined,
) =>
  !ai
    ? Effect.fail(new ClefError({ message: "没有绑定 Workers AI（AI），clef 不可用" }))
    : Effect.tryPromise({
        try: () => ai.run(CLEF_ID, { model: CLEF_MODEL, ...request }),
        catch: (cause) => new ClefError({ message: `clef 请求失败：${String(cause)}` }),
      }).pipe(
        Effect.flatMap((body) => {
          const decoded = decode(body);
          return decoded
            ? Effect.succeed(decoded)
            : Effect.fail(new ClefError({ message: "clef 返回内容无法解析" }));
        }),
      );

const chunks = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const ClefLive = (ai: ClefBinding | undefined): Layer.Layer<Clef> =>
  Layer.succeed(Clef, {
    ask: (request) =>
      Effect.forEach(
        chunks(Object.entries(request.questions), MAX_QUESTIONS),
        (part) => {
          const sub: ClefRequest = { state: request.state, questions: Object.fromEntries(part) };
          return run(ai, sub, (body) => decodeAnswers(body, sub));
        },
        { concurrency: 4 },
      ).pipe(
        Effect.map((parts) => ({
          model: parts[0]?.model ?? CLEF_MODEL,
          answers: Object.assign({}, ...parts.map((p) => p.answers)) as Record<string, ClefChoice>,
        })),
        Effect.withSpan("clef.ask"),
      ),
    noul: (request) =>
      run(ai, request, (body) => decodeNoulAnswers(body, request)).pipe(
        Effect.withSpan("clef.noul"),
      ),
  });
