/**
 * 给发邀请的 agent 的说明书：一页 Markdown，`GET /admin/guide` 和公开的 `/llms.txt` 都返回它。
 * 接口清单、字段、限制都只在这里写一次（index.ts 顶部的注释指向这里）；模板和模型的清单由调用方传进来
 * （来自 TEMPLATES / MODELS），不在这里重复。令牌不在这里：它是凭证，放在提问方的密钥文件里。
 */
import { MAX_PROVIDED_BYTES } from "./provided.ts";
import { MAX_CRITERIA, MAX_GOAL } from "./templates.ts";

export type GuideTemplate = {
  readonly name: string;
  readonly title: string;
  readonly version: number;
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
  readonly templates: ReadonlyArray<GuideTemplate>;
  readonly defaultTemplate: string;
  readonly models: ReadonlyArray<GuideModel>;
  readonly defaultModel: string;
}): string => `# agent-survey：给 agent 的说明书

一个**越问越短的表单**：你交给它一份目标和一些已知信息，它派一个 agent 去问受访者（受访者在一个链接里一轮一轮回答），问完交回一份**原样的记录**。记录拿去干什么，不归它管。
你（提问方的 agent）做三件事：**发邀请 → 等 → 取记录**。受访者那一侧的接口（\`/i/...\`）不是给你用的。

## 认证

\`Authorization: Bearer <ADMIN_TOKEN>\`。令牌在提问方的密钥文件里（本仓库的 \`data/prod-secrets.json\` 或 \`.dev.vars\`，都不入库）。没带或不对 = 401。

命令行（读同一份令牌，输出 JSON）：\`node scripts/invite.ts <create|list|result|wait|rotate|delete|guide|templates|models> …\`

## 典型流程

1. \`POST ${o.origin}/admin/interviews\` → 得到受访者的链接 \`url\`（**只发给这位受访者本人**：地址里的 key 就是门）。
2. 等他答完：\`GET /admin/interviews/<code>/result\` 看 \`phase\`（\`thinking\` 访谈者在想 / \`asking\` 等受访者答 / \`done\` 结束）；命令行 \`wait\` 会替你轮询。创建时给了 \`notify\`，结束时也会 POST 通知你一次（见下）。
3. \`phase = done\` 后取记录：同一个 \`/result\`。

## 接口

| 方法 路径 | 作用 |
|---|---|
| \`POST /admin/interviews\` | 创建访谈，返回受访者链接 |
| \`GET /admin/interviews\` | 列表：code、url、phase、轮数 |
| \`GET /admin/interviews/<code>/result\` | **取记录**（JSON）；\`?format=md\` 是同一份的人读版 |
| \`GET /admin/interviews/<code>\` | 全部内容（所有轮次、答案、对话统计）——体积大，调试才用 |
| \`GET /admin/interviews/<code>/secrets/<题号>\` | 解密读出一道 \`secret\`（密码 / 账号）题的答案，每次读取都记下时间；记录和 \`/result\` 里这类题只有一个标记，没有明文 |
| \`GET /admin/interviews/<code>/file?path=…\` | 读访谈者工作区里的任一文件（受访者上传和预置的文件转成的文字、agent 的笔记） |
| \`POST /admin/interviews/<code>/materials\` | 预置资料：multipart（\`source\` + 多个 \`file\`）或 JSON \`{source, urls}\`，见下 |
| \`POST /admin/interviews/<code>/start\` | 创建时给了 \`start: false\` 才需要：资料放完，让访谈者开始 |
| \`POST /admin/interviews/<code>/rotate\` | 换 key，旧链接立刻失效 |
| \`DELETE /admin/interviews/<code>\` | **不可恢复**：清空内容，code 永久作废 |
| \`GET /admin/templates\`、\`GET /admin/models\`、\`GET /admin/formats\` | 可选的模板、模型、受访者能上传的格式 |
| \`GET /admin/guide\`（公开副本 \`/llms.txt\`） | 本页 |

## 创建访谈：\`POST /admin/interviews\`

\`\`\`json
{ "code": "acme-2026", "brief": "…", "template": "${o.defaultTemplate}", "model": "${o.defaultModel}" }
\`\`\`

- \`code\`（必填）：小写字母、数字、横线，2–39 个字符。同时是链接的一部分和访谈者的名字。已存在 → 409，响应里带已有的链接（\`existing\`）；**删过的 code 永久作废**（\`retired: true\`），换一个。
- \`brief\`（建议写）：这次的背景，最多 ${MAX_BRIEF_CHARS} 字。见下。
- \`template\`：访谈模板，默认 \`${o.defaultTemplate}\`。可选：${o.templates.map((t) => `\`${t.name}\`（${t.title}，v${t.version}）`).join("、")}。创建时整份快照，之后改模板不影响进行中的访谈。
- \`goal\`：整段覆盖模板的目标描述（≤ ${MAX_GOAL} 字）；\`append\`：在模板（或 \`goal\`）后面追加几句。
- \`criteria\`：验收条款，字符串数组（最多 ${MAX_CRITERIA} 条），覆盖模板里的。**每条是一句能答“是 / 否”的陈述**，比如“问清了谁拍板”。有条款，访谈者想结束时，一位独立的检查者会**只对着受访者的原始回答**逐条核对，每条要引用记录里的一句原话作依据（引擎会核对这句话真的在记录里）；不满足的最多拦结束 2 次，之后放行并把没满足的写进记录。没有条款 = 不验证。
- \`respondent\`：受访者说明（外行还是专家，决定减负门的松紧）；\`intro\`：开场说明，给受访者看的（谁在问、为什么问、大约多久）；\`language\`：默认中文。
- \`pace\`：\`{ maxRounds?, perRound? }\`，**不写 = 不设限**。\`capabilities\`：\`{ web?, search?, uploads? }\`，**不写 = 全开**（\`uploads: false\` 时访谈者不能出文件 / 图片题）。受访者仍可以在每轮底部自己补充内容。
- \`fixed\`：固定题，题目数组（最多 8 题，形状同题型，\`id\` 会被加上 \`fx-\` 前缀）：一定会问、跟在第一轮 agent 题后面，例如要收的账号密码（用 \`secret\` 题型）。
- \`notify\`：完成回调地址（http/https）。结束时 POST 一次 \`{ id, phase: "done", resultUrl }\`；**不重试、不签名、不保证送达**，你仍然可以轮询。
- \`urls\`：预置网址 \`[{url, source}]\`（见下“预置资料”），最多 20 个，要过公网地址检查。
- \`start\`：默认 true（立刻开始）；要先放文件就给 false，放完再调 \`/start\`——命令行的 \`--material\` 替你做了这三步。
- \`model\`：访谈者用的模型，默认 \`${o.defaultModel}\`。线上可用：${
  o.models
    .filter((m) => m.available)
    .map((m) => `\`${m.name}\``)
    .join("、") || "（无）"
}；不可用的会被拒。
- 创建成功 → 201 \`{ ok, code, template, spec, model, url }\`。出错 → \`{ ok: false, error }\`，\`error\` 是可以直接照着改的一句话。

### \`brief\` 怎么写

访谈者只有两样东西：目标（模板）和你写的 \`brief\`。\`brief\` 写**你已经知道的事实**，让它少问：受访者是谁、做什么、你为什么发这条邀请、你从别处读到的要点。
- 不要写问题、不要写你想要的答案、不要写价格或合同金额之类敏感信息（访谈者会照着它和受访者说话，受访者也能在页面上看到访谈者整理的理解）。
- 不确定的事实写明“未确认”，访谈者会去问。
- 一两百字就够；它读的是**事实**，不是要求。

## 预置资料：开问之前先给访谈者读的东西

\`brief\` 超过 ${MAX_BRIEF_CHARS} 字会被拒，提示改成文档：**文档不限长度**（单个文件上限 ${MAX_PROVIDED_MB}MB，是平台的天花板，不是业务规则），会转成文字放进访谈者的工作区。

每份资料有**出处**，决定它能算什么：
- \`source: respondent\`——**受访者提供的**（他的画册、他给的网址，或他此前的回答）。里面的话算受访者说过的话，访谈者可以拿它当 confirm 选项的依据。
- \`source: inquirer\`——**提问方做的调研**（行业、竞品、背景整理）。是提问方的判断，不是受访者说的：只能当线索（帮访谈者猜选项），不能当依据，也不会被写成“受访者说”。

受访者在页面顶栏的“资料”里看得到全部（出处标明、可点开读转成文字的内容），所以**别放不想让受访者看到的东西**。

命令行：\`node scripts/invite.ts create --code C --brief-file b.md --material 画册.pdf --url https://官网 --inquirer 调研.md\`。

## 记录：\`GET /admin/interviews/<code>/result\`

**尽量原始**。没结束时也能取（\`phase\` 会说明），只是还没封口。

\`\`\`
{ ok, id, phase, template:{name,version}, goal, brief, respondent, language, model,
  rounds:   [{ seq, kind, intro, delta, questions:[{id,kind,title,why,mode,resolves,basis,optional,options}],
               answers:[{qid, value, skipped}], note }],
  materials:[{ ref, source, name, mime, size, status, qid, r2Key, url }],
  findings: [{ id, statement, basis:[{ref, quote}], at }],
  summary, unanswered:[{id,title}],
  validation: { criteria:[{criterion, met, evidence, note}], blocked, unmet } | null,
  finishedBy, digest }
\`\`\`

- **\`rounds\`**：每一轮问了什么（题号、题型、给的选项、选项是猜的还是出自受访者的话、为什么问）和受访者的回答原样；\`note\` 是他在那一轮底部额外写的话；\`skipped\` 是他选了“稍后再答”。
- **\`materials\`**：受访者上传（\`uploaded\`）、受访者或提问方预置（\`respondent\` / \`inquirer\`）的文件，和 agent 读过的网页（\`fetched\`，\`ref\` 是 \`page:<n>\`）。原件在 R2（\`r2Key\`），转成的文字用 \`GET …/file?path=\` 取；\`status = unconverted\` 是收下了但没能转成文字。
- **\`findings\`**：agent 看过材料、听完回答之后的**解读**，不是受访者的话。每条带依据：记录里的一处（\`answer:<题目id>\` / \`note:<轮 id>\` / \`file:<路径>\` / \`page:<n>\`）加那里的一句原话，引擎核对过这句话真的在那里；**核对的是出处，不是意思**。
- **\`unanswered\`**：稍后再答之后仍没答的题。
- **\`validation\`**：每条验收条款的结论和依据；\`unmet\` 是拦满之后放行时仍不满足的。没有条款就是 \`null\`。
- **\`digest\`**：整份记录（不含 \`digest\` 自己）的 sha-256，下游用它确认拿到的是同一份。

\`?format=md\` 返回同一份记录的人读版，由记录机械渲染，不经过任何模型。

## 注意

- 一个链接 = 一次访谈 = 一位受访者。想让同一位受访者再访谈一次，建新的 code。
- 访谈没有时间上限、受访者随时能中断后接着答；\`wait\` 的超时只是你这边的耐心。
- 受访者页面上有“agent 的理解”（agent 的工作笔记）可看可下载——不要往背景里写你不想让受访者看到的话。
- 记录会一直留着，直到你 \`DELETE\` 这场访谈。
`;
