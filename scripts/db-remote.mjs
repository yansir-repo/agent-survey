#!/usr/bin/env node
/**
 * Apply migrations to the remote D1 (operator command; the database id is the one in cloudflare.config.ts).
 *
 * No retry on purpose: the intermittent "403 … not authorized to access this service" this used to hit was the
 * first `cf` call after the OAuth token expired (see cf-ready.mjs, which `deploy` runs first). A migration that is
 * really refused must fail the deploy.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const id = /DB: bindings\.d1\(\{[^}]*id: "([0-9a-f-]{36})"/.exec(
  readFileSync(new URL("../cloudflare.config.ts", import.meta.url), "utf8"),
)?.[1];
if (!id) {
  console.error("db-remote: no D1 id in cloudflare.config.ts");
  process.exit(1);
}

const r = spawnSync("cf", ["d1", "migrations", "apply", id], { stdio: "inherit" });
process.exit(r.status ?? 1);
