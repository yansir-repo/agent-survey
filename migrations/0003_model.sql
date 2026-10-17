-- 访谈者用哪个模型：创建访谈时选，存在这里（快照，之后换默认不影响进行中的访谈）。老访谈为空串 = 默认模型。
ALTER TABLE interviews ADD COLUMN model TEXT NOT NULL DEFAULT '';
