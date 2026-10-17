#!/usr/bin/env node
/**
 * Point git at `.vite-hooks/` so the commit and push halves of the gate run for **every** writer of
 * this clone — including an agent that never reads AGENTS.md. Runs from `postinstall`.
 *
 * `vp config --hooks` generates the dispatcher into `.vite-hooks/_/` (not committed) and sets
 * `core.hooksPath`; the two scripts it calls (`.vite-hooks/pre-commit`, `.vite-hooks/pre-push`) are
 * committed, and hold one line each: the tasks themselves live in `vite.config.ts`. Skipped, with a
 * reason, outside a git checkout; `git config vp.hooks.disabled true` turns it off per clone.
 */
import { execFileSync } from "node:child_process";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** An unset key is exit code 1, not an empty string — which is not an error here. */
const gitOrEmpty = (args) => {
  try {
    return git(args);
  } catch {
    return "";
  }
};

try {
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    console.log("hooks: not a git checkout; the gate's hooks are not installed.");
    process.exit(0);
  }
  if (gitOrEmpty(["config", "--get", "vp.hooks.disabled"]) === "true") {
    console.log(
      "hooks: disabled in this clone (`git config vp.hooks.disabled true`); not installing.",
    );
    process.exit(0);
  }
  execFileSync("node_modules/.bin/vp", ["config", "--hooks", "--no-agent"], { stdio: "inherit" });
} catch (e) {
  console.log(
    `hooks: could not install (${String(e.message).split("\n")[0]}); run \`vp config --hooks\` by hand.`,
  );
}
