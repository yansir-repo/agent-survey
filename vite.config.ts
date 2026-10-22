import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite-plus";

/** The Cloudflare plugin copies `.dev.vars` into the build for `vite preview`; release artifacts must not carry it. */
const withoutDevelopmentSecrets = (): Plugin => ({
  name: "agent-survey-without-development-secrets",
  apply: "build",
  enforce: "post",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/^\.(?:dev\.vars|env)(?:\.|$)/.test(name.split(/[\\/]/).at(-1) ?? ""))
          delete bundle[name];
      }
    },
  },
});

/**
 * The judgments of the code CI can make, in one list. `pre-push` and CI both run exactly these.
 * `build` is deliberately not a judgment: it reads what the list has already read.
 */
const JUDGMENTS = ["check:types", "check:lint", "test"] as const;
/**
 * The judgments only the operator's machine makes: `pre-push` and `deploy` run them, CI never does.
 * `check:effect` is the native `effect-scan` binary, which the workspace does not install, so CI has
 * none to run; bypassing the hook bypasses it. A judgment moves into `JUDGMENTS` when CI can
 * install what it needs.
 */
const LOCAL_ONLY_JUDGMENTS = ["check:effect"] as const;

export default defineConfig({
  // The Worker decides what "/" and unknown paths answer (the interview page is only served behind its key).
  appType: "custom",
  fmt: { ignorePatterns: ["docs/**", "migrations/**", "pnpm-lock.yaml"] },
  lint: {
    ignorePatterns: ["scripts/**"],
    options: { typeAware: true, typeCheck: true },
    rules: { "no-var": "error", "typescript/no-explicit-any": "error" },
  },
  test: { include: ["src/**/*.test.ts"] },
  staged: { "*": "vp check --fix --no-error-on-unmatched-pattern" },
  run: {
    cache: { scripts: false },
    tasks: {
      dev: { command: "vp dev", cache: false },
      build: { command: "vp build", cache: false },
      "check:scripts": { command: "tsc --noEmit -p tsconfig.scripts.json", cache: false },
      "check:types": {
        command: [
          "tsc --noEmit -p src/web",
          "tsc --noEmit -p src/worker",
          "tsc --noEmit -p src/shared",
          "vp run check:scripts",
        ],
        cache: false,
      },
      "check:lint": { command: "vp lint", cache: false },
      test: { command: "vp test", cache: false },
      // The native scanner pinned in scripts/effect/scanner.json; errors and warnings both fail.
      "check:effect": { command: "node scripts/effect/strict.mjs", cache: false },
      "db:migrate": { command: "node scripts/db-local.mjs migrate", cache: false },
      // Operator command, never part of the gate: needs the remote database's id and the operator's login.
      "db:migrate:remote": { command: "node scripts/db-remote.mjs", cache: false },
      // Operator command: refreshes cf's OAuth token before it is used (the first call after an expiry is refused with 7403).
      "cf:ready": { command: "node scripts/cf-ready.mjs", cache: false },
      // Operator command, never part of the gate: talks to the live Worker with the operator's ADMIN_TOKEN. Usage: scripts/invite.ts.
      invite: { command: "node scripts/invite.ts", cache: false },
      "pre-commit": { command: "vp staged", cache: false },
      "pre-push": {
        command: [...JUDGMENTS, ...LOCAL_ONLY_JUDGMENTS].map((task) => `vp run ${task}`),
        cache: false,
      },
      ci: { dependsOn: [...JUDGMENTS], command: "vp build", cache: false },
      deploy: {
        command: [
          "vp run ci",
          ...LOCAL_ONLY_JUDGMENTS.map((task) => `vp run ${task}`),
          "vp run cf:ready",
          "vp run db:migrate:remote",
          "vp run cf:ready",
          "cf deploy --secrets-file data/prod-secrets.json",
        ],
        cache: false,
      },
    },
  },
  plugins: process.env.VITEST ? [] : [cloudflare(), withoutDevelopmentSecrets()],
});
