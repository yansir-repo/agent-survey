/// <reference path="./raw.d.ts" />
/**
 * template 的数据：引擎里**唯一**允许懂领域的地方（`src/shared/independence.test.ts` 守着这一条）。
 * 一个 template = 目标描述（goal，给 agent 看）+ 验收条款（criteria，结束前逐条验证）+ 一些可选的默认值。
 * 改它会影响之后创建的访谈；进行中的访谈用的是创建时的快照（连 version 一起）。
 */
import type { TemplateData } from "../src/shared/templates.ts";
import blank from "./blank.md?raw";
import buildBrief from "./build-brief.md?raw";
import crossBorderWebsite from "./cross-border-website.md?raw";

export const TEMPLATE_DATA: Readonly<Record<string, TemplateData>> = {
  blank: {
    version: 1,
    title: "没有模板",
    goal: blank,
    criteria: [],
  },
  "cross-border-website": {
    version: 2,
    title: "为跨境贸易 / 服务的客户做网站：搞清楚这个网站要完成什么",
    goal: crossBorderWebsite,
    criteria: [
      "记录里能看出访客是谁、带着什么疑虑来、在拿什么比较（至少一个具体的场景）",
      "记录里有客户对“主要证据”的回答：他能证明什么、证书 / 案例 / 数据是否存在、在哪里",
      "记录里有那个“动作”：访客交出什么信息、客户多快回应、之后发生什么",
      "记录里有客户怎么分产品或服务、哪类多哪类少、访客对它们做什么",
      "现在有什么、以后谁维护、边界与硬约束、参考站这几类事实：客户答了的有记录，没答的是明确的“不知道”或“稍后再答”",
      "这场访谈里没有出过 image / file 题",
    ],
    respondent: "做跨境贸易或服务的生意人，不是技术人员，时间有限。",
  },
  "build-brief": {
    version: 2,
    title: "把一次客户访谈的记录，变成开发者拍板的一组建站决定",
    goal: buildBrief,
    criteria: [
      "页面的增删和取舍有开发者的回答（或他明确说“你定”）",
      "内容类型和路由有开发者的回答",
      "字段与多语言口径有开发者的回答",
      "表单的去向（存不存、通知谁、之后发生什么）有开发者的回答",
      "媒体的边界（图片 / 视频 / 文件怎么进、谁维护）有开发者的回答",
      "“第一期不做什么”至少有一条",
    ],
    respondent: "开发者：专家，时间比普通受访者更贵，能选的不要让他写。",
  },
};
