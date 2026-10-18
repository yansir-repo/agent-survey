/** 客户端和服务端之间的形状：服务端算好、客户端只渲染。 */
import type { LiveView } from "./live.ts";
import type { Question, Value } from "./questions.ts";

export type FileInfo = {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly qid: string;
  /** ok = 已解析成文字，agent 读得到；unconverted = 收下了但解析失败，agent 只知道有这个文件。 */
  readonly status: "ok" | "unconverted";
  readonly tokens?: number;
  readonly note?: string;
};

export type RoundView = {
  readonly id: string;
  readonly seq: number;
  readonly kind: "agent" | "deferred" | "checkpoint";
  readonly intro: string;
  readonly questions: ReadonlyArray<Question>;
};

/** 阶段倒计时：系统数的（每满 of 个 agent 轮做一次检查点），所以诚实——它不声称总共多少轮。 */
export type StageView = {
  /** 第几阶段（从 1 起）。 */
  readonly number: number;
  /** 本阶段第几轮（1..of）；检查点那一轮是 of + 1。 */
  readonly round: number;
  readonly of: number;
  readonly checkpoint: boolean;
};

export type InterviewView = {
  readonly code: string;
  readonly phase: "thinking" | "asking" | "done";
  readonly round: RoundView | null;
  /** 当前这一轮每道题现在的答案（自动保存的）。 */
  readonly answers: Readonly<Record<string, Value>>;
  /** 当前这一轮里选了“稍后再答”的题。 */
  readonly skipped: ReadonlyArray<string>;
  readonly files: ReadonlyArray<FileInfo>;
  /** 已经发生的轮次（只记已发生的：下一轮问什么、还有几轮，agent 自己也还不知道）。 */
  readonly history: ReadonlyArray<{
    readonly seq: number;
    readonly kind: "agent" | "deferred" | "checkpoint";
    readonly questions: number;
    readonly skipped: number;
  }>;
  /** agent 最近一次报告的“我现在的理解”。 */
  readonly understanding: ReadonlyArray<{ readonly topic: string; readonly text: string }>;
  /** 稍后再答的题（跨轮，一个不丢）。 */
  readonly deferred: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly why: string;
  }>;
  /** 眼下这一轮在第几阶段的第几轮（回头补答那一轮没有）。 */
  readonly stage: StageView | null;
  /** 这一轮底部“还有想补充的”里客户写的字（自动保存的）。 */
  readonly note: string;
  /** agent 那边出错了（回合中断）：客户可以点“重试”。 */
  readonly error?: string;
  /** agent 正在想（thinking）时：推理文字的尾部、已经写出来的题。只活在内存里，没有就不带。 */
  readonly live?: LiveView;
  /** 访谈结束后仍没答的题。 */
  readonly unanswered: ReadonlyArray<{ readonly id: string; readonly title: string }>;
};
