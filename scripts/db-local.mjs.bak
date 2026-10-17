#!/usr/bin/env node
/**
 * Local D1 for `cf dev`, which keeps its state in ./.cloudflare/state.
 *
 *   node scripts/db-local.mjs migrate   apply ./migrations/*.sql via `cf d1 migrations apply --local`
 *
 * `cf … --local` (1.0.0-beta) prints its result but does not exit, so `migrate` stops it once the
 * result is out (a known cf beta quirk).
 */
import { spawn } from "node:child_process";

const DB = "99c00e0d-5883-4406-8d9f-38538dad0e65";
const STATE = ".cloudflare/state";

function migrate() {
  const child = spawn("cf", ["d1", "migrations", "apply", DB, "--local", "--persist-to", STATE], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const done = (code) => {
    child.kill();
    process.stdout.write(out);
    process.exit(code);
  };
  const timer = setTimeout(() => done(1), 120_000);
  const onData = (chunk) => {
    out += chunk;
    if (/\]\s*$/.test(out) || /Error/.test(out)) {
      clearTimeout(timer);
      setTimeout(() => done(/Error|❌/.test(out) ? 1 : 0), 500);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    clearTimeout(timer);
    process.stdout.write(out);
    process.exit(code ?? 1);
  });
}

if (process.argv[2] === "migrate") migrate();
else {
  console.error("usage: node scripts/db-local.mjs migrate");
  process.exit(2);
}
