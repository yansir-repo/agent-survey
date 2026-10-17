import { describe, expect, it } from "vitest";
import {
  MAX_NUDGES,
  STAGE_FORCE,
  STAGE_ROUNDS,
  checkpointForced,
  initial,
  openedDeferred,
  step,
  type Event,
  type Machine,
} from "./machine.ts";

const run = (events: Event[], from: Machine = initial) => {
  let m = from;
  const all: unknown[] = [];
  for (const e of events) {
    const r = step(m, e);
    m = r.machine;
    all.push(...r.effects);
  }
  return { m, effects: all };
};
const asked = (roundId: string): Event => ({ t: "agentAsked", roundId });
const submitted = (
  roundId: string,
  answered: string[],
  skipped: string[],
  kind: "agent" | "deferred" | "checkpoint" = "agent",
): Event => ({
  t: "submitted",
  roundId,
  kind,
  answered,
  skipped,
});

describe("interview state machine", () => {
  it("thinking → asking → thinking: the agent asks, the client answers, the agent continues", () => {
    const { m, effects } = run([asked("r1"), submitted("r1", ["a", "b"], [])]);
    expect(m.phase).toBe("thinking");
    expect(m.open).toBeNull();
    expect(effects).toEqual([{ t: "prompt", why: "answers" }]);
  });

  it("nothing is lost: skipped questions accumulate across rounds until they are answered", () => {
    const { m } = run([
      asked("r1"),
      submitted("r1", ["a"], ["b"]),
      asked("r2"),
      submitted("r2", ["c"], ["d"]),
    ]);
    expect(m.deferred).toEqual(["b", "d"]);
  });

  it("a deferred question answered in a later round leaves the list (it cannot be answered there, but the machine would drop it)", () => {
    const { m } = run([
      asked("r1"),
      submitted("r1", ["a"], ["b"]),
      asked("r2"),
      submitted("r2", ["b", "c"], []),
    ]);
    expect(m.deferred).toEqual([]);
  });

  it("when the agent finishes with deferred questions, the SYSTEM opens one catch-up round; the agent cannot skip it", () => {
    const { m, effects } = run([
      asked("r1"),
      submitted("r1", ["a"], ["b", "c"]),
      { t: "agentFinished" },
    ]);
    expect(m.phase).toBe("asking");
    expect(m.deferredRoundOpened).toBe(true);
    expect(effects).toContainEqual({ t: "openDeferredRound", questionIds: ["b", "c"] });
  });

  it("after the catch-up round, what is still unanswered stays unanswered and the interview ends", () => {
    const start = run([asked("r1"), submitted("r1", ["a"], ["b", "c"]), { t: "agentFinished" }]).m;
    const open = openedDeferred(start, "d1");
    const { m, effects } = run(
      [submitted("d1", ["b"], ["c"], "deferred"), { t: "agentFinished" }],
      open,
    );
    expect(m.phase).toBe("done");
    expect(m.deferred).toEqual(["c"]);
    expect(effects).toContainEqual({ t: "prompt", why: "deferred-answers" });
    expect(effects).toContainEqual({ t: "done" });
  });

  it("finishing with nothing deferred is done, no catch-up round", () => {
    const { m, effects } = run([asked("r1"), submitted("r1", ["a"], []), { t: "agentFinished" }]);
    expect(m.phase).toBe("done");
    expect(effects).toContainEqual({ t: "done" });
    expect(effects).not.toContainEqual(expect.objectContaining({ t: "openDeferredRound" }));
  });

  it("a silent agent turn is nudged, at most twice, then treated as finished", () => {
    const silent: Event = { t: "agentSilent" };
    const { m, effects } = run(Array.from({ length: MAX_NUDGES + 1 }, () => silent));
    expect(effects.filter((e) => (e as { why?: string }).why === "nudge")).toHaveLength(MAX_NUDGES);
    expect(m.phase).toBe("done");
  });

  it("a stale or duplicate submission changes nothing (idempotent)", () => {
    const base = run([asked("r1")]).m;
    expect(step(base, submitted("r0", ["a"], [])).machine).toBe(base);
    const after = run([submitted("r1", ["a"], [])], base).m;
    expect(step(after, submitted("r1", ["a"], [])).machine).toBe(after);
  });

  it("events that do not fit the phase are ignored (an agent cannot ask while the client is answering)", () => {
    const asking = run([asked("r1")]).m;
    expect(step(asking, asked("r2")).machine).toBe(asking);
    expect(step(asking, { t: "agentFinished" }).machine).toBe(asking);
  });
});

describe("stages: after STAGE_ROUNDS rounds the system urges a checkpoint; the agent picks the moment; STAGE_FORCE forces it", () => {
  const round = (n: number): Event[] => [asked(`r${n}`), submitted(`r${n}`, ["a"], [])];
  const rounds = (count: number): Event[] =>
    Array.from({ length: count }, (_, i) => round(i + 1)).flat();

  it("the countdown is the system's: stageRounds counts answered agent rounds, nothing else", () => {
    const { m } = run(rounds(3));
    expect(m.stageRounds).toBe(3);
    expect(m.checkpointDue).toBe(false);
  });

  it("filling the stage only urges: the agent is told it is time, and may still ask (it finishes its current line of questions first)", () => {
    const { m, effects } = run(rounds(STAGE_ROUNDS));
    expect(m.checkpointDue).toBe(true);
    expect(effects.at(-1)).toEqual({ t: "prompt", why: "answers-urge" });
    expect(step(m, asked("rX")).machine.phase).toBe("asking");
  });

  it("before the stage is full a checkpoint is not allowed", () => {
    const m = run(rounds(STAGE_ROUNDS - 1)).m;
    expect(step(m, { t: "agentCheckpointed", roundId: "c1" }).machine).toBe(m);
  });

  it("if the agent keeps putting it off, at STAGE_FORCE the system insists and ignores further questions", () => {
    const urged = run(rounds(STAGE_FORCE - 1)).m;
    expect(urged.checkpointDue).toBe(true);
    const { m, effects } = run([asked("rF"), submitted("rF", ["a"], [])], urged);
    expect(effects.at(-1)).toEqual({ t: "prompt", why: "checkpoint-due" });
    expect(checkpointForced(m)).toBe(true);
    expect(step(m, asked("rX")).machine).toBe(m);
  });

  it("a checkpoint opens a round for the customer; answering it starts the next stage from zero", () => {
    const urged = run(rounds(STAGE_ROUNDS + 2)).m;
    const { m, effects } = run(
      [{ t: "agentCheckpointed", roundId: "c1" }, submitted("c1", ["x", "y"], [], "checkpoint")],
      urged,
    );
    expect(m.stage).toBe(1);
    expect(m.stageRounds).toBe(0);
    expect(m.checkpointDue).toBe(false);
    expect(effects).toContainEqual({ t: "prompt", why: "checkpoint-answers" });
  });

  it("the checkpoint round itself and the catch-up round do not count toward a stage", () => {
    const afterCp = run(
      [{ t: "agentCheckpointed", roundId: "c1" }, submitted("c1", [], [], "checkpoint")],
      run(rounds(STAGE_ROUNDS)).m,
    ).m;
    expect(afterCp.stageRounds).toBe(0);
    const { m } = run([asked("r1"), submitted("r1", ["a"], ["b"]), { t: "agentFinished" }]);
    const open = openedDeferred(m, "d1");
    expect(run([submitted("d1", [], ["b"], "deferred")], open).m.stageRounds).toBe(1);
  });

  it("skipped questions keep accumulating across stages and checkpoints (nothing is lost)", () => {
    const events = [...rounds(STAGE_ROUNDS - 1), asked("rN"), submitted("rN", ["a"], ["late"])];
    const urged = run(events).m;
    expect(urged.deferred).toEqual(["late"]);
    const { m } = run(
      [{ t: "agentCheckpointed", roundId: "c1" }, submitted("c1", [], [], "checkpoint")],
      urged,
    );
    expect(m.deferred).toEqual(["late"]);
  });

  it("finishing is always allowed, with or without a pending checkpoint (no pointless final summary for a one-question tail)", () => {
    const urged = run(rounds(STAGE_ROUNDS + 1)).m;
    const { m } = run([{ t: "agentFinished" }], urged);
    expect(m.phase).toBe("done");
    expect(m.checkpointDue).toBe(false);
  });
});
