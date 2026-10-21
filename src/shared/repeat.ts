/**
 * 别把受访者已经“稍后再答”的题再问一遍：系统最后会补问它们，重复的只会让受访者对同一件事跳过好几次（线上实测：20 道待补答里同一件事出现 3 次）。
 * 只用标题的字面相似度（字符二元组 Jaccard），不用模型：能拦住原样重问和小改动；换一种说法的重问拦不住，那一类靠上游堵——
 * 结束检查者不再把待补答的题列成“现在能问”（finish-judge 的 deferred 编号）。
 */
export const REPEAT_AT = 0.65;

const norm = (t: string): string => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const bigrams = (t: string): ReadonlySet<string> => {
  const n = norm(t);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
};
export const similarity = (a: string, b: string): number => {
  const A = bigrams(a);
  const B = bigrams(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  const all = A.size + B.size - both;
  return all === 0 ? 0 : both / all;
};

export type Pending = { readonly id: string; readonly title: string };

/** 新出的题里，哪些在重复一道待补答的题。返回给 agent 的话。 */
export const repeatsPending = (
  questions: ReadonlyArray<{ readonly id: string; readonly title: string }>,
  pending: ReadonlyArray<Pending>,
): string[] =>
  questions.flatMap((q) => {
    const hit = pending.find((p) => similarity(q.title, p.title) >= REPEAT_AT);
    return hit
      ? [
          `题 ${q.id}：和受访者已经选了“稍后再答”的题（${hit.id}「${hit.title}」）是同一件事——系统会在最后补问它，不要再问一遍`,
        ]
      : [];
  });
