/**
 * 给发邀请的 agent 的说明书：一页 Markdown，`GET /admin/guide` 和公开的 `/llms.txt` 都返回它。
 * 接口清单、字段、限制都只在这里写一次（index.ts 顶部的注释指向这里）；预设和模型的清单由调用方传进来（来自 PROFILES / MODELS），
 * 不在这里重复。令牌不在这里：它是凭证，放在运营的密钥文件里。
 */
import { MAX_PROVIDED_BYTES } from "./provided.ts";

export type GuideProfile = {
  readonly name: string;
  readonly title: string;
  readonly stage: "client" | "dev";
};
export type GuideModel = {
  readonly name: string;
  readonly title: string;
  readonly available: boolean;
};

export const MAX_BRIEF_CHARS = 8000;
const MAX_PROVIDED_MB = MAX_PROVIDED_BYTES / 1024 / 1024;

export const guideText = (o: {
  readonly origin: string;
  readonly profiles: ReadonlyArray<GuideProfile>;
  readonly defaultProfile: string;
  readonly models: ReadonlyArray<GuideModel>;
  readonly defaultModel: string;
}): string => `# grill-me：给 agent 的说明书

一个访谈工具：你发一条邀请链接给客户，客户在页面上一轮一轮回答访谈者（另一个 agent）的问题。客户访谈得到 \`/CONTEXT.md\`（叙事）和 \`/facts.json\`（五类事实的结构化契约）。
同一个引擎可以开第二场：客户访谈结束后，用 \`build-brief\` 预设采访开发者，把客户的话变成《建站交底》：\`/CONTEXT.md\`（给人看）+ \`/model.json\`（给下游的机器契约）。
你（运营侧的 agent）做三件事：**发邀请 → 等 → 取结果**。客户那一侧的接口（\`/i/...\`）不是给你用的。

## 认证

\`Authorization: Bearer <ADMIN_TOKEN>\`。令牌在运营的密钥文件里（本仓库的 \`data/prod-secrets.json\` 或 \`.dev.vars\`，都不入库）。没带或不对 = 401。

命令行（读同一份令牌，输出 JSON）：\`node scripts/invite.ts <create|list|result|wait|rotate|delete|guide|profiles|models> …\`

## 典型流程

1. \`POST ${o.origin}/admin/interviews\` → 得到客户链接 \`url\`（**只发给这位客户本人**：地址里的 key 就是门）。
2. 等客户答完：\`GET /admin/interviews/<code>/result\` 看 \`phase\`（\`thinking\` 访谈者在想 / \`asking\` 等客户答 / \`done\` 访谈结束）；命令行 \`wait\` 会替你轮询。
3. \`phase = done\` 后，同一个 \`/result\` 里有 \`context\`（CONTEXT.md 全文）、\`summary\`、\`unanswered\`（客户始终没答的题）。
4. 客户 \`done\` 后，命令行 \`create --from <客户 code>\` 发起第二场（开发者访谈）：原始记录作为客户资料、CONTEXT 作为我们的整理预置进去；得到开发者链接（**只发内部**）。
5. 开发者访谈的 \`CONTEXT.md\` 就是《建站交底》；用 \`result\` 取出来，交给下一步“规划结构”。

## 接口

| 方法 路径 | 作用 |
|---|---|
| \`POST /admin/interviews\` | 创建访谈，返回客户链接 |
| \`GET /admin/interviews\` | 列表：code、url、phase、轮数 |
| \`GET /admin/interviews/<code>/result\` | **取结果**：phase、summary、context、unanswered、轮数（很小，轮询用它） |
| \`GET /admin/interviews/<code>/record\` | 原始问答记录（题、回答、补充、跳过的题、文件开头）——交接给第二场用 |
| \`GET /admin/interviews/<code>\` | 全部内容（所有轮次、答案、对话统计）——体积大，调试才用 |
| \`GET /admin/interviews/<code>/file?path=/CONTEXT.md\` | 读访谈者工作区里的任一文件 |
| \`POST /admin/interviews/<code>/materials\` | 预置资料：multipart（\`source\` + 多个 \`file\`）或 JSON \`{source, urls}\`，见下 |
| \`POST /admin/interviews/<code>/start\` | 创建时给了 \`start: false\` 才需要：资料放完，让访谈者开始 |
| \`POST /admin/interviews/<code>/rotate\` | 换 key，旧链接立刻失效 |
| \`DELETE /admin/interviews/<code>\` | **不可恢复**：清空内容，code 永久作废 |
| \`GET /admin/profiles\`、\`GET /admin/models\`、\`GET /admin/formats\` | 可选的预设、模型、客户能上传的格式 |
| \`GET /admin/guide\`（公开副本 \`/llms.txt\`） | 本页 |

## 创建访谈：\`POST /admin/interviews\`

\`\`\`json
{ "code": "acme-2026", "brief": "…", "profile": "${o.defaultProfile}", "model": "${o.defaultModel}" }
\`\`\`

- \`code\`（必填）：小写字母、数字、横线，2–39 个字符。同时是链接的一部分和访谈者的名字。已存在 → 409，响应里带已有的链接（\`existing\`）；**删过的 code 永久作废**（\`retired: true\`），换一个。
- \`brief\`（建议写）：这位客户的背景，最多 ${MAX_BRIEF_CHARS} 字。见下。
- \`profile\`：任务预设，默认 \`${o.defaultProfile}\`。可选：${o.profiles.map((p) => `\`${p.name}\`（${p.title}${p.stage === "dev" ? "，开发者访谈" : ""}）`).join("、")}。
- \`mission\`：整段覆盖预设（自己写任务，≤ 12000 字）；\`append\`：在预设（或 \`mission\`）后面追加几句。
- \`urls\`：预置网址 \`[{url, source}]\`（见下“预置资料”），最多 20 个，要过公网地址检查。
- \`start\`：默认 true（立刻开始）；要先放文件就给 false，放完再调 \`/start\`——命令行的 \`--material\` 替你做了这三步。
- \`--from <客户 code>\`（命令行）：从已结束的客户访谈发起第二场。默认 code 是 \`<客户 code>-dev\`，profile 是 \`build-brief\`；自动把 \`RECORD.txt\` 作为客户资料、\`CONTEXT.txt\` + \`HANDOFF.txt\`（以及客户访谈的 \`facts.json\`，如果有）作为我们的整理预置进去，然后开始。客户访谈没 \`done\` 会拒绝。
- \`model\`：访谈者用的模型，默认 \`${o.defaultModel}\`。线上可用：${
  o.models
    .filter((m) => m.available)
    .map((m) => `\`${m.name}\``)
    .join("、") || "（无）"
}；不可用的会被拒。
- 创建成功 → 201 \`{ ok, code, profile, stage, deliverables, model, url }\`。出错 → \`{ ok: false, error }\`，\`error\` 是可以直接照着改的一句话。

### \`brief\` 怎么写

访谈者只有两样东西：任务（预设）和你写的 \`brief\`。\`brief\` 写**你已经知道的事实**，让它少问：客户是谁、做什么、你为什么发这条邀请、你从别处读到的（网站、资料里的）要点。
- 不要写问题、不要写你想要的答案、不要写价格或合同金额之类敏感信息（访谈者会照着它和客户说话，客户也能在页面上看到访谈者整理的理解）。
- 不确定的事实写明“未确认”，访谈者会去问。
- 一两百字就够；写长了也行，但它读的是**事实**，不是要求。

## 预置资料：开问之前先给访谈者读的东西

\`brief\` 超过 ${MAX_BRIEF_CHARS} 字会被拒，提示改成文档：**文档不限长度**（单个文件上限 ${MAX_PROVIDED_MB}MB，是平台的天花板，不是业务规则），会转成文字放进访谈者的工作区。

每份资料有**出处**，决定它能算什么：
- \`source: client\`——**客户提供的**（画册、报价单、他给的网址）。里面的话算客户说过的话，访谈者可以拿它当 confirm 选项的依据。
- \`source: ours\`——**我们做的调研**（行业、竞品）。是我们的判断，不是客户说的：只能当线索（帮访谈者猜选项），不能当依据，也不会被写成“客户说”。

客户在页面顶栏的“资料”里看得到全部（出处标明、可点开读转成文字的内容），所以**别放不想让客户看到的东西**。访谈者读资料期间，客户页面会显示它在读什么，不会是一片空白。

命令行：\`node scripts/invite.ts create --code C --brief-file b.md --material 画册.pdf --url https://客户官网 --ours 竞品调研.md\`。

## 客户访谈的 /facts.json

客户访谈除了 \`CONTEXT.md\`，还会用 \`record_facts\` 提交 \`/facts.json\`：五类只有客户知道的事实（现在有什么、他怎么分、以后谁维护、边界与硬约束、参考）+ 动作。\`CONTEXT.md\` 是给人看的叙事；\`/facts.json\` 是给开发者访谈和下游的。

\`finish_interview\` 会校验它：五类关键句不能空白（\`facts-five\`），不能有 \`example.com\` / \`待填写\` 这类占位（\`facts-no-placeholders\`），参考站不能同一个网址既喜欢又讨厌（\`references-distinct\`）。所以客户访谈的 agent 要主动调用 \`record_facts\`，不能只写 CONTEXT.md。

## 第二场：开发者访谈（handoff）

客户访谈 \`phase = done\` 后：

\`\`\`sh
node scripts/invite.ts create --from mz-041          # 默认 mz-041-dev，profile=build-brief
node scripts/invite.ts wait --code mz-041-dev
node scripts/invite.ts result --code mz-041-dev --out BRIEF.md --json-out model.json
\`\`\`

- 链接**只发内部**：它包含客户访谈的记录和整理。
- 第二场的 \`CONTEXT.md\` 是给人看的《建站交底》；\`/model.json\` 是给下游（草图 / zeroY）的机器契约。agent 用 \`propose_model\` 提交它：Schema（site-model）+ gate（页面职责、路由对页面、引用存在、类型有字段）不过，\`finish_interview\` 会退回。
- \`--json-out\` 写出 \`/model.json\`；不写就只打印在 \`deliverables\` 里。
- 客户始终没答的题放在 \`HANDOFF.txt\` 里；开发者访谈可以把它标成“待确认 / 客户”。
- 要补资料：\`POST /admin/interviews/<code>/materials\`（\`source=client\` 是客户的话，\`source=ours\` 是我们的整理），随时可以加。

## 结果：\`GET /admin/interviews/<code>/result\`

\`{ ok, code, phase, rounds, summary, context, deliverables, unanswered }\`。\`context\` 是主交付物（Markdown）全文；\`deliverables\` 是 \`[{path, format, text}]\`（开发者访谈里含 \`/model.json\`）；\`unanswered\` 是 \`[{id, title}]\`。\`phase\` 不是 \`done\` 时 \`context\` 是**进行中的草稿**，不要当成交付物。

## 注意

- 一个链接 = 一次访谈 = 一位客户。想让同一客户再访谈一次，建新的 code。
- 访谈没有时间上限、客户随时能中断后接着答；\`wait\` 的超时只是你这边的耐心。
- 客户页面上有“agent 的理解”（CONTEXT.md）可看可下载——不要往里写你不想让客户看到的话。
`;
