-- 访谈登记：一个访谈一行。访问地址 /i/<code>.<key>，key 就是门（16 位随机十六进制）。
-- 访谈自己的一切（轮次、答案、文件、对话）都在它的 Durable Object 里；这里只有“有哪些访谈、钥匙是什么”。
CREATE TABLE interviews (
  code       TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  brief      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER
);
