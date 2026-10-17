/**
 * 访谈的状态机：纯函数。DO 只负责“把事件喂进来、照着 effect 去做”，所有关于流程的判断都在这里。
 *
 *   starting ─begin→ thinking ─agentAsked→ asking ─submitted→ thinking ─…→ done
 *
 * 不变量：**客户没答的题一个都不会丢**。客户选“稍后再答”的题进 `deferred`；agent 说完（finish）时，
 * 只要还有，就由系统（不是 agent）开一轮“回头补答”；那一轮之后还没答的就是“待确认”，访谈结束。
 * agent 没有“重新问一遍”的权力，也没有“忘记”的可能。
 */

export type Phase = "thinking" | "asking" | "done";

export type Machine = {
  readonly phase: Phase;
  /** 已经开过几轮（agent 的和回头补答的都算）。 */
  readonly rounds: number;
  /** 眼下等客户回答的那一轮。 */
  readonly open: string | null;
  /** 客户选了“稍后再答”、还没答的题。 */
  readonly deferred: ReadonlyArray<string>;
  /** 回头补答那一轮开过没有（只开一次）。 */
  readonly deferredRoundOpened: boolean;
  /** agent 这一回合既没提问也没结束（违反协议）时，提醒过几次。 */
  readonly nudges: number;
};

export const initial: Machine = {
  phase: "thinking",
  rounds: 0,
  open: null,
  deferred: [],
  deferredRoundOpened: false,
  nudges: 0,
};

export type Event =
  | { readonly t: "agentAsked"; readonly roundId: string }
  | { readonly t: "agentFinished" }
  /** agent 这一回合结束了，但没有调用 ask_round 也没有调用 finish_interview。 */
  | { readonly t: "agentSilent" }
  | {
      readonly t: "submitted";
      readonly roundId: string;
      readonly kind: "agent" | "deferred";
      readonly answered: ReadonlyArray<string>;
      readonly skipped: ReadonlyArray<string>;
    };

export type Effect =
  /** 给 agent 发一条消息，让它继续。 */
  | { readonly t: "prompt"; readonly why: "answers" | "deferred-answers" | "nudge" }
  /** 开一轮“回头补答”，题目是这些 id（题的内容是以前问过的原样）。 */
  | { readonly t: "openDeferredRound"; readonly questionIds: ReadonlyArray<string> }
  | { readonly t: "done" };

export const MAX_NUDGES = 2;

export const step = (
  m: Machine,
  e: Event,
): { machine: Machine; effects: ReadonlyArray<Effect> } => {
  switch (e.t) {
    case "agentAsked":
      return m.phase === "thinking"
        ? {
            machine: { ...m, phase: "asking", open: e.roundId, rounds: m.rounds + 1, nudges: 0 },
            effects: [],
          }
        : { machine: m, effects: [] };
    case "agentSilent":
      if (m.phase !== "thinking") return { machine: m, effects: [] };
      return m.nudges < MAX_NUDGES
        ? { machine: { ...m, nudges: m.nudges + 1 }, effects: [{ t: "prompt", why: "nudge" }] }
        : step({ ...m, nudges: 0 }, { t: "agentFinished" });
    case "agentFinished": {
      if (m.phase !== "thinking") return { machine: m, effects: [] };
      if (m.deferred.length > 0 && !m.deferredRoundOpened)
        return {
          machine: {
            ...m,
            phase: "asking",
            deferredRoundOpened: true,
            rounds: m.rounds + 1,
            nudges: 0,
          },
          effects: [{ t: "openDeferredRound", questionIds: m.deferred }],
        };
      return { machine: { ...m, phase: "done", open: null }, effects: [{ t: "done" }] };
    }
    case "submitted": {
      if (m.phase !== "asking" || m.open !== e.roundId) return { machine: m, effects: [] };
      const stillDeferred =
        e.kind === "deferred"
          ? [...e.skipped]
          : [...m.deferred.filter((id) => !e.answered.includes(id)), ...e.skipped];
      return {
        machine: {
          ...m,
          phase: "thinking",
          open: null,
          deferred: [...new Set(stillDeferred)],
          nudges: 0,
        },
        effects: [{ t: "prompt", why: e.kind === "deferred" ? "deferred-answers" : "answers" }],
      };
    }
  }
};

/** 回头补答开出来之后，DO 记下它的 roundId，机器的 open 指向它。 */
export const openedDeferred = (m: Machine, roundId: string): Machine => ({ ...m, open: roundId });
