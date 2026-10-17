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
