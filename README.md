# grill-me

需求访谈：客户在这里一轮一轮回答 agent 的问题（每轮 1–8 题），直到 agent 把要搞懂的都搞懂。agent 自己决定每道题用什么交互方式
（单选、多选、数字、文字、多行、富文本、链接、图片、文档），可以要客户上传资料、自己读、也可以上网看客户给的网址。
客户不确定的题可以选“稍后再答”，一个都不会丢。产出是一份 `/CONTEXT.md`（已知 / 不知道 / 假设）和客户的原始回答与资料。

- [AGENTS.md](AGENTS.md) — 改代码时要守的规矩（设计的不变量、边界、门禁、部署）。
- [docs/mockup.html](docs/mockup.html) — 最早的界面草图（静态）。

```sh
pnpm install
cp .dev.vars.example .dev.vars    # 填 DEEPSEEK_API_KEY 和一个 ADMIN_TOKEN
pnpm exec vp run db:migrate && pnpm exec vp dev
node scripts/play.mjs --code try-1      # 扮演客户，跟真的 agent 跑完一次访谈（花 token）
pnpm exec vp run ci                     # 门禁：类型 + lint + 测试 + effect 扫描 + build
```
