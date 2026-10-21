/**
 * 预置资料（已知信息）：访谈开始之前，提问方放进访谈者工作区的资料，分两种出处——
 *   respondent  受访者提供的（画册、报价单、他给的网址，或他此前的回答）。里面的话算“受访者说过的话”，可以作为 confirm 选项的依据（basis）。
 *   inquirer    提问方做的调研（行业、竞品、背景整理）。是提问方的判断，不是受访者说的：只能当线索（猜选项），不能当依据。
 * 受访者在页面上看得到全部（出处标明）。出处由存放的目录决定，是唯一的事实：provided/respondent/、provided/inquirer/。
 */
import type { FileInfo } from "./api.ts";

export type Source = "respondent" | "inquirer";
export const SOURCES: ReadonlyArray<Source> = ["respondent", "inquirer"];

export const SOURCE_LABEL: Readonly<Record<Source, string>> = {
  respondent: "受访者提供的",
  inquirer: "提问方做的调研",
};

export const providedQid = (s: Source): string => `provided-${s}`;
export const providedDir = (s: Source): string => `provided/${s}/`;
export const sourceOfQid = (qid: string): Source | null =>
  qid === providedQid("respondent")
    ? "respondent"
    : qid === providedQid("inquirer")
      ? "inquirer"
      : null;
export const isSource = (v: unknown): v is Source => v === "respondent" || v === "inquirer";

/**
 * 预置资料单个文件的上限：不是业务规则，是平台的天花板（Worker 请求体 100MB、内存 128MB，一个文件要在内存里转两次）。
 * 比受访者上传的 20MB 宽得多；更大的以后走直传 R2，到那时再改。
 */
export const MAX_PROVIDED_BYTES = 50 * 1024 * 1024;

export type ProvidedUrl = { readonly url: string; readonly source: Source };

/** 给访谈者的开场清单：放了什么、各自能算什么。没有预置资料就是空串。 */
export const providedListing = (
  files: ReadonlyArray<Pick<FileInfo, "path" | "name" | "qid" | "status">>,
  urls: ReadonlyArray<ProvidedUrl>,
  markdownOf: (path: string) => string,
): string => {
  const part = (s: Source): string[] => {
    const fs = files.filter((f) => sourceOfQid(f.qid) === s);
    const us = urls.filter((u) => u.source === s);
    return [
      ...fs.map((f) =>
        f.status === "ok"
          ? `- ${markdownOf(f.path)}（原件 ${f.name}，已转成文字）`
          : `- ${f.path}（${f.name}：没能转成文字，你读不到内容）`,
      ),
      ...us.map((u) => `- 网址 ${u.url}（用 fetch_page 读）`),
    ];
  };
  const given = part("respondent");
  const research = part("inquirer");
  if (given.length === 0 && research.length === 0) return "";
  return [
    "提问方在访谈开始前放进来的资料（受访者在页面上也看得到它们）：",
    ...(given.length
      ? [
          "",
          "【受访者提供的】——里面的话算受访者说过的话，可以作为 confirm 选项的依据（basis 要逐字引用）：",
          ...given,
        ]
      : []),
    ...(research.length
      ? [
          "",
          "【提问方做的调研】——这是提问方自己的判断，不是受访者说的：只能当线索（帮你猜选项），不能当依据，也不要写成“受访者说”：",
          ...research,
        ]
      : []),
    "",
    "先读（读多少、读哪些由你判断），资料已经回答了的事不要再问受访者；资料说得含糊或互相矛盾的地方才问。",
  ].join("\n");
};
