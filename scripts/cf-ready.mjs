#!/usr/bin/env node
/**
 * Make sure `cf`'s OAuth token is fresh before a command that uses it (operator command, part of `deploy`).
 *
 * Failure model (measured 2026-10-17, two token expiries): the first `cf` API call made after the OAuth access
 * token has expired is refused with "[7403] The given account is not valid or is not authorized to access this
 * service" — and that same call refreshes the token, so every later call succeeds. It looked like an intermittent
 * flake on `cf d1 migrations apply` only because that is usually the first call after a long gap. `cf auth whoami`
 * performs the refresh, so running it first spends the refusal on a call that does not matter.
 *
 * Exits 1 only when the login itself is gone (then: `cf auth login`). Remove this when `cf` refreshes before using
 * an expired token (the symptom to watch for: a 7403 on the first call after an hour).
 */
import { spawnSync } from "node:child_process";

const whoami = () => {
  const r = spawnSync("cf", ["auth", "whoami"], { encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return {};
  }
};

// Twice: the call that performs the refresh may itself be the refused one.
for (let attempt = 1; attempt <= 2; attempt++) {
  const w = whoami();
  if (w.authenticated && w.tokenValid) process.exit(0);
}
console.error(
  "cf-ready: not logged in to Cloudflare (or the token cannot be refreshed). Run: cf auth login",
);
process.exit(1);
