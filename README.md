# agent-survey

> 线上 Worker / D1 / R2 的标识仍是 `grill-me`（见 AGENTS.md「部署」），地址 `grill-me.yansir.workers.dev` 不变。

**越问越短的表单。** 调用方交给它一份说明和一些已知信息，它派一个 agent 去问受访者：每轮 1–8 题，题型自己选（单选、多选、数字、文字、多行、富文本、链接、图片、文件），已知的不再问，选项尽量替受访者猜好。不确定的题可以选“稍后再答”，一个都不会丢。问完交回一份**原样的记录**，记录拿去干什么，不归它管。

它完全独立：不认识任何调用它的系统，领域知识只在 `templates/`（`src/shared/independence.test.ts` 守着）。设计见 `docs/design-agent-survey.md`。

## 给 agent：发邀请链接

**发邀请 → 等 → 取记录**，都有命令（输出 JSON，`--pretty` 给人看）：

```sh
export GRILL_ADMIN_TOKEN=…        # 或放进 data/prod-secrets.json / .dev.vars
node scripts/invite.ts guide                                  # 先读说明书
node scripts/invite.ts templates                              # 有哪些模板
node scripts/invite.ts create --code acme-2026 --template cross-border-website \
  --brief-file brief.md --material 画册.pdf --url https://example.com   # 受访者提供的资料
node scripts/invite.ts wait --code acme-2026 --md record.md   # 等到结束再取；或 result 随时取
```

- 模板 = 目标 `goal` + 验收条款 `criteria` + 默认（受访者说明、开场说明、节奏、能力、语言）；`--goal-file` 整段覆盖、`--append` 追加、`--criteria-file` 换条款。节奏和能力默认不设限。
- 预置资料两种出处：`--material/--url`（受访者提供的，算他说过的话）和 `--inquirer/--inquirer-url`（提问方做的调研，只当线索）。
- 记录（`result`）：对话、材料、agent 的解读（带依据原话，机械核对）、没答的、验收结果、元数据和摘要。没有“交付物”。
- `--notify <url>`：结束时 POST 一次 `{id, phase, resultUrl}`（不重试）。

## 开发

```sh
pnpm install
pnpm exec vp run ci          # 类型 + lint + 测试 + build（CI 跑的就是这个）
pnpm exec vp run check:effect  # 原生 effect-scan，只在本地（pre-push/deploy）；安装见 AGENTS.md
pnpm exec vp run db:migrate && pnpm exec vp dev
```

规矩见 `AGENTS.md`。
