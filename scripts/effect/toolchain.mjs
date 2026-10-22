import fs from "node:fs";
import path from "node:path";

/**
 * The installed `effect` is the one the catalog names, and no other copy answers to the repository
 * from above it. A stale install (the catalog moved, `pnpm install` did not) or a checkout nested under
 * another one (an unresolved import falls back to the parent's `node_modules`) makes the compiler read
 * types of a version nobody declared; the findings that follow are about the wrong library. Returns the
 * refusals, empty when the install is the declared one.
 */
export function effectInstallProblems(root) {
  const catalog = /^ {2}effect:\s*['"]?([^\s'"#]+)/m.exec(
    fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  )?.[1];
  if (catalog === undefined) return ["pnpm-workspace.yaml has no `effect` catalog entry"];
  const versionAt = (directory) => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(directory, "node_modules/effect/package.json"), "utf8"),
      ).version;
    } catch {
      return undefined;
    }
  };
  const problems = [];
  const installed = versionAt(root);
  if (installed !== catalog)
    problems.push(
      `node_modules/effect is ${installed ?? "missing"}, the catalog says ${catalog}; run pnpm install`,
    );
  for (let up = path.dirname(root); up !== path.dirname(up); up = path.dirname(up)) {
    const above = versionAt(up);
    if (above !== undefined && above !== catalog)
      problems.push(
        `${up}/node_modules/effect is ${above}: an import this checkout cannot resolve would fall back to it`,
      );
  }
  return problems;
}
