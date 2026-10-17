/**
 * Credentials for the operator surface from a terminal (`/admin/mcp`), shared by
 * `do.ts`.
 *
 * The operator surface sits behind Cloudflare Access. A machine gets in with an Access **service token**
 * (`CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET`), read from the environment first and then from
 * `.dev.vars` (gitignored). The Worker records the actor as `service:<client id>`, so a run says which
 * credential did it. Against `cf dev` on localhost there is no Access and no credential is needed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

/** 找凭证：环境变量 → 当前目录的 .dev.vars（在客户项目仓库里跑时，用的是那个仓库的凭证）→ 本仓库的 .dev.vars。 */
export const devVar = (name: string): string => {
  if (process.env[name]) return process.env[name]!;
  for (const dir of [process.cwd(), root]) {
    const file = path.join(dir, ".dev.vars");
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    if (line)
      return line
        .slice(name.length + 1)
        .replace(/^["']|["']$/g, "")
        .trim();
  }
  return "";
};

export const isLocalBase = (base: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(base).origin);

/** Headers for the operator surface at `base`; exits with a usage error when a deployed app has no credential. */
export const accessHeaders = (base: string): Record<string, string> => {
  const id = devVar("CF_ACCESS_CLIENT_ID");
  const secret = devVar("CF_ACCESS_CLIENT_SECRET");
  if (id && secret) return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
  if (isLocalBase(base)) return {};
  console.error(
    "CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET are not set (environment or .dev.vars): the operator surface is behind Cloudflare Access.",
  );
  process.exit(2);
};
