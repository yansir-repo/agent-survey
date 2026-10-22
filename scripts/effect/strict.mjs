import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { effectInstallProblems } from "./toolchain.mjs";

/**
 * The local Effect gate: the native `effect-scan` binary over this repository, in strict mode.
 *
 * The scanner's own exit status reflects errors only; warnings are report-only to it. This gate
 * also fails on a warning, because a reading the gate prints and does not stop is one nobody decides.
 *
 * The binary is not a dependency of the workspace and CI does not run this (`LOCAL_ONLY_JUDGMENTS`
 * in `vite.config.ts`); it is a judgment of the machine that pushes or deploys. So every way of not having the
 * pinned scanner is a failure with the way to get it: a gate that skipped when the binary was
 * missing would read as a pass. The pinned build is `scripts/effect/scanner.json`, the one place a
 * scanner version is written down.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "scanner.json"), "utf8"));
const evidence = path.join(root, "data/effect-evidence");

const fail = (message) => {
  console.error("check:effect: " + message);
  process.exit(1);
};

const installHint =
  `install the pinned scanner: in the effect-ecosystem checkout, \`git checkout ${pin.gitCommit}\` ` +
  "and `make install` (puts it at ~/.local/bin/effect-scan), or point EFFECT_SCAN_BIN at a binary " +
  `whose \`--build-info\` buildId is ${pin.buildId}`;

function locate() {
  const named = process.env.EFFECT_SCAN_BIN;
  if (named !== undefined && named !== "") {
    if (!fs.existsSync(named)) fail(`EFFECT_SCAN_BIN=${named} does not exist; ${installHint}`);
    return named;
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory === "") continue;
    const candidate = path.join(directory, "effect-scan");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this directory
    }
  }
  return fail(`effect-scan is not on PATH and EFFECT_SCAN_BIN is unset; ${installHint}`);
}

const scanner = locate();
const info = spawnSync(scanner, ["--build-info"], { encoding: "utf8" });
let built;
try {
  built = JSON.parse(info.stdout).buildId;
} catch {
  built = undefined;
}
if (info.status !== 0 || typeof built !== "string")
  fail(`${scanner} did not answer --build-info; ${installHint}`);
if (built !== pin.buildId)
  fail(
    `${scanner} is build ${built}, the pinned build is ${pin.buildId}. To move to ${built}, edit ` +
      `scripts/effect/scanner.json (buildId, gitCommit) and re-run; to use the pinned one, ${installHint}`,
  );

const stale = effectInstallProblems(root);
if (stale.length > 0)
  fail("the installed Effect is not the declared one:\n  " + stale.join("\n  "));

fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
fs.rmSync(path.join(evidence, "gate-summary.json"), { force: true });
const output = fs.openSync(path.join(evidence, "command-output.json"), "w", 0o600);
let result;
try {
  result = spawnSync(
    scanner,
    [
      root,
      "--strict",
      "--fail-on-suppression-drift",
      "--output",
      "gate-json",
      "--evidence",
      evidence,
    ],
    { cwd: root, stdio: ["ignore", output, "inherit"] },
  );
} finally {
  fs.closeSync(output);
}
if (result.error) throw result.error;
if (result.signal) fail("scanner interrupted: " + result.signal);
// 0 and 1 are scan outcomes; 2 (scanner failure) and 64 (usage) are not verdicts of any kind.
if (result.status !== 0 && result.status !== 1) fail(`scanner exited ${result.status}`);

const summaryFile = path.join(evidence, "gate-summary.json");
if (!fs.existsSync(summaryFile)) fail("the scanner wrote no gate-summary.json");
const gate = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
if (gate.scanner.buildId !== pin.buildId)
  fail(`the summary names build ${gate.scanner.buildId}, not the pinned ${pin.buildId}`);

const { errors, warnings } = gate.summary;
console.log(`check:effect ${gate.scanner.buildId}: ${errors} errors, ${warnings} warnings`);
for (const finding of Object.values(gate.tiers).flat()) {
  if (finding.severity !== "error" && finding.severity !== "warning") continue;
  console.log(
    `  ${finding.severity} ${finding.ruleId} ${finding.file}:${finding.line ?? 0} ${finding.message}`,
  );
}
console.log("Evidence: " + summaryFile);
process.exitCode =
  result.status === 0 && gate.ok === true && errors === 0 && warnings === 0 ? 0 : 1;
