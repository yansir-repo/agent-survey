# AGENTS.md

需求访谈（grill-me）。README 讲用途；本文件是改代码时要守的规矩。

## 这是什么，不是什么

- **一个独立项目**，和 flue-zeroy、米站看板（`~/code/52/36-mizhan-projects`）都不共用代码和数据：不 import `@zeroy/*`，不读它们的库。
  客户在这里上传的资料，将来是否用于别的系统（建站等），是另一件事，到时候单独做导出。技术栈相同（cf CLI + vite-plus + Effect Schema + Think），做法只借鉴。
- 单 Worker：`/i/<code>.<key>`（客户的访谈页和 API）、`/admin/*`（运营接口）。一个访谈 = D1 一行（code → key、背景）+ 一个 Think Durable Object（名字 = code）。

## 设计的不变量（改之前先看它们）

1. **问题的词表是封闭的**（`src/shared/questions.ts`）：agent 每题自己选交互方式，但方式只有 single / multi / number / text / long / rich / link / image / file。
   同一份 Effect Schema 是 TS 类型、agent 的工具入参、客户端渲染的依据。加一种方式 = 在这里加一项 + `validateAnswer` 加一条规则 + 客户端渲染一条，别处不用动。
   MVP **没有 archive 和 video**（见下）。
2. **客户没答的题一个都不会丢**（`src/shared/machine.ts`，纯函数，配 `machine.test.ts`）：客户选“稍后再答”的题进 `deferred`；agent 结束时只要还有，就由**系统**开一轮“回头补答”——agent 没有重新问的权力，也没有忘记的可能。补答那一轮之后仍没答的是“待确认”，访谈结束，**不替客户编**。
3. **流程判断只在状态机里**：`interview.ts` 把事件喂给 `step`、照返回的 effect 去做；`interviewer.ts`（Durable Object）是唯一的可执行边缘，只把 Promise 接口的调用交给 `runInterviewEffect`，类里没有业务判断、没有 `async`。
4. **客户的一切输入都是不可信的**：富文本过 `sanitizeRich` 白名单、再转 Markdown 才给 agent（`rich.ts`）；文件内容、网页内容对 agent 都是**数据不是指令**（指令里写了，`fetch_page` 的返回也带了标注）；agent 读网页先过 `url-guard.ts`（只放行公网 http(s)，拒 IP 字面量/内网后缀/账号密码/非常规端口，重定向之后的地址再过一遍）。
5. **能收什么文件只有一个出处**（`src/shared/files.ts`）：格式 = Workers AI `toMarkdown` 能转的 + 纯文本；上传框上给客户看的格式说明来自同一份（`formatsText`），agent **不能**在题里写格式说明（schema 里没有 hint）。`GET /admin/formats` 对照线上 `env.AI.toMarkdown().supported()` 报告漂移。
6. **上传不半收**（`upload.ts`）：守门（格式、大小、这道题收不收、数量）→ 原件进 R2（`FILES`，键 `<code>/<路径>`）→ 转 Markdown → 访谈者写进工作区 `/uploads/<题id>/<名字>.md` 并记 files 表。转换失败不是异常：文件照收，标 `unconverted` 并告诉 agent“收到了但没能解析”。
   实测要点（线上 `toMarkdown`）：docx、PDF（带元数据和分页）、图片（得到的是**图片描述**，不是文字识别）都正常；**CSV 它按 Latin-1 读，中文会乱码**，所以 CSV 和纯文本一样由我们自己按 UTF-8 读（`convert.ts`，配 `convert.test.ts`）；Blob 必须带 MIME 类型，空类型会被拒（`mimeOf`）。
7. **状态只有一个家**：访谈者的 SQLite（rounds / answers / files / kv）。客户端不存任何东西，每次轮询拿服务端算好的 `InterviewView`（`src/shared/api.ts`）；答一题存一题（防抖 500ms 的 PUT）。
8. **agent 的工具面很窄**：`ask_round`（问一轮，成功后本回合停）、`finish_interview`（需要 `/CONTEXT.md` 已写好）、`fetch_page`，加 Think 自带的工作区工具。它改不了客户的答案。`/CONTEXT.md` 是交付物。指令和消息模板只在 `src/shared/prompt.ts`。

## 通用工具：任务层与协议层（`src/shared/prompt.ts`、`src/shared/profiles.ts`、`profiles/*.md`）

- 这个工具以“把一件事问清楚”为核心，问什么主题由**任务层**决定；**协议层**（怎么提问、工作区、检查点、不能做什么）固定在 `prompt.ts`，**不可被覆盖**——它的每一条都对应代码里一道真实的门，被覆盖掉流程会崩。
- 预设 = `profiles/<名>.md`（随代码评审、随部署上线）。发链接时 `POST /admin/interviews {code, brief, profile?, mission?, append?}`：选预设（默认 `cross-border-website`）、`mission` 整段覆盖、`append` 在预设后面追加。解析后的最终文本存进访谈（D1 的 `interviews.mission`，创建时快照）——之后改预设不影响进行中的访谈；老访谈两列为空，回退默认预设。`GET /admin/profiles` 列预设。
- 第一个预设 `cross-border-website`（给米站的网站需求访谈）从生成式推出：**网站 = 由「访客的决定」选出的「证据」，终止于一个「动作」，受「真实」约束**；范围切在“动作”那一刻的交接接口（只有“报价需要知道什么→表单字段”和“多快回应→页面承诺”穿过它），所以销售流程不再是无限话题；完成的判据是每个元素都能写成“访客疑虑→证据→资产（有/要补/给不了）”三元组。改这份预设后，用 `scripts/dogfood.mjs` + `scripts/judge.mjs` 对照跑（见 `docs/dogfood-2026-10-17.md`）。
- 轮数**不设上限**、也没有强制结束；每轮 1–8 题由 agent 定（作文题 long/rich 每轮最多 1 道，一题一个问号，见 `shapeProblems`）；收集资料由 agent 判断（不卡第一轮）。

## 阶段检查点（`machine.ts`：`STAGE_ROUNDS = 10` 开始催，`STAGE_FORCE = 16` 强制）

- 一个阶段问满 10 个 agent 轮之后，**系统开始催**检查点；**时机由 agent 选**——把手头这一块问完、到自然的停顿点再做，不机械卡在第 10、20 轮（否则最后一个阶段可能只剩一两题还被迫小结）。拖到第 16 轮，系统强制：`ask_round` 被拒（工具和状态机两头都拒），必须先做检查点。agent 直接 `finish_interview` 永远允许，不需要最后补一次小结。
- 检查点怎么做：先重写 `CONTEXT.md`（和上一个检查点相比要真改过：指纹不同），再调 `checkpoint`，把这一阶段听到的 6–12 条要点交给客户。题目由系统生成（agent 不能夹带别的题）：每条一道选填单选——对 / 不确定 / 不对，应该是…（客户自己写，`otherLabel`）。客户的纠正以他写的为准。
- 客户页上的阶段提示（`InterviewView.stage`）是**系统数的**，所以诚实：满 10 轮之前只说“再问大约 N 轮”，之后不再画倒计时，只说“第几轮、问完手头这一块就给你小结”；回头补答那一轮不计入。

## 模型（`src/shared/models.ts`，发链接时 `model` 选）

- 访谈者用哪个模型是**每个访谈**的选择，创建时存进去（D1 `interviews.model` 和 DO 的 kv）。名字是我们自己的稳定名字（`deepseek-flash` / `claude-sonnet-5-5` / `claude-haiku-5-5` / `gpt-6.1-sol` / `gpt-6-luna`）；DeepSeek 直连，其余经 AIHubMix（OpenAI 兼容的聚合接口，`AIHUBMIX_API_KEY`）。**线上这个密钥固定为 `none`**，所以线上只有 DeepSeek 可用（`GET /admin/models` 报各模型是否可用）；要在线上用别的，先给 Worker 配真密钥。
- `docs/model-comparison-2026-10-17.md`：同一份提示词、同一位模拟客户下的对比。摘要：DeepSeek 最快且零协议摩擦，但最像“填问卷”；Sonnet 5.5 最贴预设的方法；Haiku 5.5 碎且重复；GPT 6.1 Sol 深但慢 5 倍；GPT 6 Luna 在这个用法下卡死。每个模型只跑了一次，评分是 LLM 打的。
- `GET /admin/interviews/<code>` 的 `stats` 记协议摩擦：`askRefused`（提问被拒）、`nudges`（回合没调任何工具被提醒）、`turnErrors`、`checkpointRefused`、`finishRefused`。

## 无人值守对照（`scripts/dogfood.mjs`、`scripts/judge.mjs`、`scripts/personas/`）

- `dogfood.mjs`：用一份档案扮演客户（LLM），对线上跑完整访谈，记录每一轮；`--profile / --mission-file / --append` 选任务层；`--resume` 接着跑。`judge.mjs`：用同一把尺给每个问题分类（在不在“做网站”的范围内）、给每份 `CONTEXT.md` 按预设的完成判据打分。会花模型 token，不在门禁里。
- 局限（写在报告里，别忽略）：模拟客户的知识面有限，所以访谈到 8 轮就自己收尾；评审也是 LLM，偏宽松。用来对比相对差异，不是绝对质量。

## MVP 明确不做（后面再议）

- **解压缩**（zip 等）和**视频/音频**：上传时拒绝并告诉客户为什么（`rejectReason`）。要做解压，做成固定工具（防压缩炸弹、路径穿越），不要让 agent 写代码解压。
- 旧版 .doc / .ppt / .rtf：`toMarkdown` 不认，请客户另存为 docx / pptx / PDF。（PowerPoint 的 pptx 系列是支持的：官方文档页没列，线上 `supported()` 有——`/admin/formats` 就是为这种漂移准备的。）扫描件 PDF 没有文字层，转出来是空的，会标 `unconverted`（OCR 是后面的事）。
- 搜索引擎：agent 只能读客户给的网址（`fetch_page`），没有搜索。
- 运营接口用一个**共享令牌**（`ADMIN_TOKEN`，`Authorization: Bearer`），不是 Cloudflare Access。失败模型：令牌泄露 = 运营接口被滥用；移除条件：运营不止一两个人、或要审计“谁做了什么”时，换成 Access（照 `~/code/52/38-sketch-wireframe` 的 `access.ts`）。
- 客户的身份就是地址里的 key（capability URL，16 位随机十六进制，`rotate` 换 key 旧链接立刻失效）。公开上传入口的滥用防护目前只有：单文件 20MB、每题最多 10 个文件、访谈要先由运营创建。要开放给陌生人时再加频率限制和每访谈的 token 预算。

## 门禁（人和 agent 走同一条）

- `vp run ci` = 类型（web / worker / shared / scripts 四个工程）+ lint + 测试 + `check:effect` + build。`pre-push` 和 CI 跑同一个列表。
- `check:effect` 必须通过：业务代码不用 `async`/`await`/`Date.now()`/`try/catch`；时间用 `Clock`；`.effect-skill.json` 是清单（可执行边缘只有 `interviewer.ts` 的 `runInterviewEffect`）。
- 本地：`pnpm exec vp run db:migrate && pnpm exec vp dev`。**本地没有 `AI` 绑定**（Workers AI 只能远程）：纯文本和 CSV 能转，PDF/Office/图片只能线上验。
- **Durable Object 的 RPC 可能比 Think 的 `onStart` 先到**：部署后 DO 第一次被醒来就收到上传时，`this.workspace` 还是 undefined（实测）。`interviewer.ts` 的 `ws()` 按 Think 的同一种建法先建好，Think 之后沿用。动工作区的新代码一律走 `ws()`。
- `node scripts/play.mjs --base <url> --code <新 code>`：扮演客户和真 agent 跑完整个访谈（创建 → 回答 → 跳过 → 回头补答 → 结束 → 打印 CONTEXT.md）。会花模型 token，不在门禁里；改了流程、提示词、词表之后跑一次。

## 部署

- `vp run deploy` = ci → `cf:ready`（刷新 cf 令牌：令牌过期后的第一个 `cf` 调用会被拒，见 38 的 docs/deploy.md）→ 远程迁移 → `cf:ready` → `cf deploy --secrets-file data/prod-secrets.json`。
- 密钥在 `data/prod-secrets.json`（gitignored）：`DEEPSEEK_API_KEY`、`ADMIN_TOKEN`。模型是 DeepSeek（OpenAI 兼容接口，thinking 关闭）。
- 资源：Worker `grill-me`、D1 `grill-me`、R2 `grill-me-files`、Durable Object `Interviewer`（SQLite）。创建访谈：`POST /admin/interviews {code, brief}` → 客户的链接。
