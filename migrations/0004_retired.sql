-- 删掉的访谈：code 同时是 Durable Object 的名字，DO 里的表被清空后不能原样复用，所以 code 永久作废。
CREATE TABLE retired_codes (
  code       TEXT PRIMARY KEY,
  retired_at INTEGER NOT NULL
);
