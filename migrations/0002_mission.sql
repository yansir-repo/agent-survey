-- 任务层的快照：创建访谈时解析好的最终文本（预设 / 整段覆盖 / 追加），之后改预设不影响进行中的访谈。
-- 老访谈两列为空串：运行时回退到默认预设。
ALTER TABLE interviews ADD COLUMN profile TEXT NOT NULL DEFAULT '';
ALTER TABLE interviews ADD COLUMN mission TEXT NOT NULL DEFAULT '';
