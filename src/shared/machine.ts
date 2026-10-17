/**
 * 访谈的状态机：纯函数。DO 只负责“把事件喂进来、照着 effect 去做”，所有关于流程的判断都在这里。
 *
 *   thinking ─agentAsked→ asking ─submitted→ thinking ─…→ done
 *                                     └─ 每满 STAGE_ROUNDS 轮 → 检查点（agent 必须 checkpoint，不能 ask_round）
 *
 * 不变量一：**客户没答的题一个都不会丢**。客户选“稍后再答”的题进 `deferred`；agent 说完（finish）时，
 * 只要还有，就由系统（不是 agent）开一轮“回头补答”；那一轮之后还没答的就是“待确认”，访谈结束。
 * 不变量二：**阶段节奏由系统数，不由 agent 猜**。每满 STAGE_ROUNDS 个 agent 轮，系统要求一次检查点（agent 重写 CONTEXT.md，
 * 客户逐条确认或纠正）。所以“本阶段第 N / 10 轮”是诚实的倒计时——它不声称总共多少轮。
 */

/** 一个阶段有几轮（agent 的提问轮；回头补答和检查点本身不算）。 */
export const STAGE_ROUNDS = 10;

export type Phase = "thinking" | "asking" | "done";

export type Machine = {
  readonly phase: Phase;
  /** 已经开过几轮（agent 的、检查点的和回头补答的都算）。 */
  readonly rounds: number;
  /** 眼下等客户回答的那一轮。 */
  readonly open: string | null;
  /** 客户选了“稍后再答”、还没答的题。 */
  readonly deferred: ReadonlyArray<string>;
  /** 回头补答那一轮开过没有（只开一次）。 */
  readonly deferredRoundOpened: boolean;
  /** agent 这一回合既没提问也没结束（违反协议）时，提醒过几次。 */
  readonly nudges: number;
  /** 已经完成了几次检查点（= 已完成的阶段数）。 */
  readonly stage: number;
  /** 当前阶段里已经答完的 agent 轮数。 */
  readonly stageRounds: number;
  /** 这一阶段满了，agent 必须做检查点。 */
  readonly checkpointDue: boolean;
};

export const initial: Machine = {
  phase: "thinking",
  rounds: 0,
  open: null,
  deferred: [],
  deferredRoundOpened: false,
  nudges: 0,
  stage: 0,
  stageRounds: 0,
  checkpointDue: false,
};

export type Event =
  | { readonly t: "agentAsked"; readonly roundId: string }
  /** agent 做了检查点：开了一轮“请客户确认我听到的”。 */
  | { readonly t: "agentCheckpointed"; readonly roundId: string }
  | { readonly t: "agentFinished" }
  /** agent 这一回合结束了，但没有调用 ask_round / checkpoint / finish_interview。 */
  | { readonly t: "agentSilent" }
  | {
      readonly t: "submitted";
      readonly roundId: string;
      readonly kind: "agent" | "deferred" | "checkpoint";
      readonly answered: ReadonlyArray<string>;
      readonly skipped: ReadonlyArray<string>;
    };

export type Effect =
  /** 给 agent 发一条消息，让它继续。 */
  | {
      readonly t: "prompt";
      readonly why:
        | "answers"
        | "checkpoint-due"
        | "checkpoint-answers"
        | "deferred-answers"
        | "nudge";
    }
  /** 开一轮“回头补答”，题目是这些 id（题的内容是以前问过的原样）。 */
  | { readonly t: "openDeferredRound"; readonly questionIds: ReadonlyArray<string> }
  | { readonly t: "done" };

export const MAX_NUDGES = 2;

const unchanged = (m: Machine) => ({ machine: m, effects: [] as ReadonlyArray<Effect> });

export const step = (
  m: Machine,
  e: Event,
): { machine: Machine; effects: ReadonlyArray<Effect> } => {
  switch (e.t) {
    case "agentAsked":
      // 检查点没做完之前不能再提问（工具那一侧也拒绝了；这里是同一条规则的另一半）
      return m.phase === "thinking" && !m.checkpointDue
        ? {
            machine: { ...m, phase: "asking", open: e.roundId, rounds: m.rounds + 1, nudges: 0 },
            effects: [],
          }
        : unchanged(m);
    case "agentCheckpointed":
      return m.phase === "thinking" && m.checkpointDue
        ? {
            machine: {
              ...m,
              phase: "asking",
              open: e.roundId,
              rounds: m.rounds + 1,
              nudges: 0,
              checkpointDue: false,
            },
            effects: [],
          }
        : unchanged(m);
    case "agentSilent":
      if (m.phase !== "thinking") return unchanged(m);
      return m.nudges < MAX_NUDGES
        ? { machine: { ...m, nudges: m.nudges + 1 }, effects: [{ t: "prompt", why: "nudge" }] }
        : step({ ...m, nudges: 0 }, { t: "agentFinished" });
    case "agentFinished": {
      if (m.phase !== "thinking") return unchanged(m);
      if (m.deferred.length > 0 && !m.deferredRoundOpened)
        return {
          machine: {
            ...m,
            phase: "asking",
            deferredRoundOpened: true,
            rounds: m.rounds + 1,
            nudges: 0,
            checkpointDue: false,
          },
          effects: [{ t: "openDeferredRound", questionIds: m.deferred }],
        };
      return {
        machine: { ...m, phase: "done", open: null, checkpointDue: false },
        effects: [{ t: "done" }],
      };
    }
    case "submitted": {
      if (m.phase !== "asking" || m.open !== e.roundId) return unchanged(m);
      const base = { ...m, phase: "thinking" as const, open: null, nudges: 0 };
      if (e.kind === "deferred")
        return {
          machine: { ...base, deferred: [...new Set(e.skipped)] },
          effects: [{ t: "prompt", why: "deferred-answers" }],
        };
      const deferred = [
        ...new Set([...m.deferred.filter((id) => !e.answered.includes(id)), ...e.skipped]),
      ];
      if (e.kind === "checkpoint")
        return {
          machine: { ...base, deferred, stage: m.stage + 1, stageRounds: 0, checkpointDue: false },
          effects: [{ t: "prompt", why: "checkpoint-answers" }],
        };
      const stageRounds = m.stageRounds + 1;
      const due = stageRounds >= STAGE_ROUNDS;
      return {
        machine: { ...base, deferred, stageRounds, checkpointDue: due },
        effects: [{ t: "prompt", why: due ? "checkpoint-due" : "answers" }],
      };
    }
  }
};

/** 回头补答开出来之后，DO 记下它的 roundId，机器的 open 指向它。 */
export const openedDeferred = (m: Machine, roundId: string): Machine => ({ ...m, open: roundId });
