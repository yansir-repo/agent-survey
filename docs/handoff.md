# 客户访谈 → 开发者访谈（handoff）

一个项目两场访谈，都用 grill-me：

1. **客户访谈**：`cross-border-website` 预设，客户链接。产出 `CONTEXT.md`（叙事）+ `facts.json`（五类事实的结构化契约）。
2. **开发者访谈**：`build-brief` 预设，内部链接。产出两份：`CONTEXT.md`（给人看的《建站交底》）和 `/model.json`（给下游的机器契约：BSP + 内容模型 + 路由）。

## 五步

> 本地跑：`--base http://localhost:5173` 时，CLI 会先读 `data/prod-secrets.json`（线上令牌）；先
> `export GRILL_ADMIN_TOKEN=$(grep '^ADMIN_TOKEN=' .dev.vars | cut -d= -f2-)` 覆盖它。

1. 客户访谈结束：

   ```sh
   node scripts/invite.ts wait --code mz-041
   # 或 node scripts/invite.ts result --code mz-041 看 phase = done
   # 取客户两份交付物：node scripts/invite.ts result --code mz-041 --out CONTEXT.md --json-out facts.json
   ```

2. 一条命令交接：

   ```sh
   node scripts/invite.ts create --from mz-041
   ```

   - 默认第二场 code = `mz-041-dev`，profile = `build-brief`。
   - `RECORD.txt` → `source=client`（客户原话，开发者 agent 的 `confirm` 能引用）。
   - `CONTEXT.txt` + `HANDOFF.txt` → `source=ours`（我们的整理，不当客户的话）。
   - 客户访谈的 `facts.json` 也一起带过去（`source=ours`）。
   - 客户访谈没 `done` 会拒绝；没有跳过的手工步骤。

3. 把打印出来的开发者链接发给大锤（**只发内部**）。

4. 等开发者答完：

   ```sh
   node scripts/invite.ts wait --code mz-041-dev
   ```

5. 取交底：

   ```sh
   node scripts/invite.ts result --code mz-041-dev --out BRIEF.md --json-out model.json
   ```

   `--json-out` 取的是开发者访谈用 `propose_model` 提交、并且通过了 `site-model` + gate 的 `/model.json`。

## 看什么

- 客户访谈的 `facts.json` 是五类事实（现站/分类/维护/边界/参考 + 动作）；agent 用 `record_facts` 提交，`facts-five` / `facts-no-placeholders` / `references-distinct` 会拦空白、占位和重复参考站。
- 第二场的 `CONTEXT.md` 是给人看的《建站交底》，结构在 `profiles/build-brief.md` 里。
- `/model.json` 是机器契约：`pages`（BSP）、`types`（内容模型 / 路由 / 字段 / intake）、`vocabularies`、`locales`。agent 用 `propose_model` 提交；`site-model` 解码 + gate 不过，`finish_interview` 会退回。不要把版式、种子、模板写进它。
- 客户始终没答的题在 `HANDOFF.txt`（工作区 `provided/ours/HANDOFF.txt.md`）里；开发者访谈会把它标成“待确认 / 客户”。
- 要补资料：`POST /admin/interviews/mz-041-dev/materials`，`source=client`（客户的话）或 `source=ours`（我们的整理），随时可以加。

## 不要做

- 不要把开发者链接发给客户：它包含客户访谈的记录和整理。
- 不要在客户访谈没 `done` 时发起第二场：`--from` 会拒绝，不要手工绕过。
- 不要把第二场的 `CONTEXT.md` 或 `/model.json` 当客户文档：它们是内部交底。
- 客户访谈的 `facts.json` 是给下一场的输入，不是客户文档；客户看的是 `CONTEXT.md`。
- 不要手写 `/model.json`：用 `propose_model`，否则 gate 不过时 `finish_interview` 会拦。
