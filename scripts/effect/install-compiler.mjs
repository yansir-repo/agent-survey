import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const expectedVersion = "Version 7.0.2+effect-tsgo.0.45.0";
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function run(root, executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0)
    throw Error(
      result.error?.message || result.stderr || result.stdout || "Compiler command failed",
    );
  return result.stdout.trim();
}
function ownedFile(root, file) {
  const stat = fs.lstatSync(file);
  const relative = path.relative(
    path.join(fs.realpathSync(root), "node_modules"),
    fs.realpathSync(file),
  );
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Compiler file is not owned by this installation: " + file);
}
function resolveCompiler(root) {
  const require = createRequire(path.join(root, "package.json"));
  const typescript = require.resolve("typescript/package.json");
  const tsgo = require.resolve("@effect/tsgo/package.json");
  for (const [file, version] of [
    [typescript, "7.0.2"],
    [tsgo, "0.45.0"],
  ]) {
    ownedFile(root, file);
    if (JSON.parse(fs.readFileSync(file, "utf8")).version !== version)
      throw Error("Unexpected compiler package version: " + file);
  }
  const cli = path.join(path.dirname(tsgo), "dist/effect-tsgo.cjs");
  ownedFile(root, cli);
  // Official selector matches TypeScript gitHead to packaged binary metadata; never --force.
  const source = run(root, process.execPath, [cli, "get-exe-path"]);
  ownedFile(root, source);
  const platform = createRequire(typescript).resolve(
    `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
  );
  ownedFile(root, platform);
  const binary = path.join(
    path.dirname(platform),
    "lib",
    process.platform === "win32" ? "tsc.exe" : "tsc",
  );
  const entry = path.join(root, "node_modules/typescript/bin/tsc");
  ownedFile(root, entry);
  return { cli, source, binary, entry, sha256: hash(source) };
}
function verify(root, compiler) {
  ownedFile(root, compiler.binary);
  if (hash(compiler.binary) !== compiler.sha256)
    throw Error("Effect compiler is not installed; run vp install");
  if (run(root, process.execPath, [compiler.entry, "--version"]) !== expectedVersion)
    throw Error("Installed compiler did not report the expected Effect version");
  return compiler;
}
export function verifyCompiler(root = repository) {
  return verify(root, resolveCompiler(root));
}
export function installCompiler(root = repository) {
  const compiler = resolveCompiler(root);
  const { binary, sha256, cli } = compiler;
  const backup = binary + ".original";
  const lock = path.join(path.dirname(binary), ".effect-install.lock");
  fs.mkdirSync(lock); // Exclusive and fail closed, including an interrupted installer.
  try {
    ownedFile(root, binary);
    if (hash(binary) === sha256) return { ...verify(root, compiler), changed: false };
    const originalHash = hash(binary);
    if (run(root, process.execPath, [compiler.entry, "--version"]) !== "Version 7.0.2")
      throw Error("Refusing to replace an unexpected TypeScript compiler");
    if (fs.existsSync(backup)) {
      ownedFile(root, backup);
      if (hash(backup) !== originalHash)
        throw Error("Unexpected compiler backup; repair installation explicitly");
      fs.unlinkSync(backup); // A verified reinstall left the same pristine backup.
    }
    const otherBackups = fs
      .readdirSync(path.dirname(binary))
      .filter((name) => name.startsWith(path.basename(backup) + "."));
    if (otherBackups.length)
      throw Error("Unexpected historical compiler backups; repair installation explicitly");
    try {
      // The official patch renames the old inode before copying and chmodding the new one.
      run(root, process.execPath, [
        cli,
        "patch",
        "--typescript",
        "--typescript-package",
        "typescript",
      ]);
      ownedFile(root, backup);
      if (hash(backup) !== originalHash) throw Error("Original compiler backup changed");
      return { ...verify(root, compiler), changed: true };
    } catch (error) {
      if (fs.existsSync(backup)) {
        ownedFile(root, backup);
        if (hash(backup) !== originalHash)
          throw Error("Cannot restore an unverified compiler backup", { cause: error });
        if (fs.existsSync(binary)) {
          ownedFile(root, binary);
          if (hash(binary) !== sha256)
            throw Error("Cannot replace an unexpected failed compiler", { cause: error });
        }
        fs.renameSync(backup, binary);
        if (hash(binary) !== originalHash)
          throw Error("Compiler restoration failed", { cause: error });
      }
      throw error;
    }
  } finally {
    fs.rmdirSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = installCompiler();
  console.log(`Effect compiler ${result.changed ? "installed" : "verified"}: ${expectedVersion}`);
}
