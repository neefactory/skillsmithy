import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "skillsmithy-package-acceptance-"),
);

try {
  const artifacts = path.join(temporaryRoot, "artifacts");
  const previousSource = path.join(temporaryRoot, "previous-source");
  const runner = path.join(temporaryRoot, "runner");
  const destination = path.join(temporaryRoot, "minted-skill");
  fs.mkdirSync(artifacts, { recursive: true });

  copyPackageSource(repositoryRoot, previousSource);
  const previousPackagePath = path.join(previousSource, "package.json");
  const previousPackage = JSON.parse(
    fs.readFileSync(previousPackagePath, "utf8"),
  );
  previousPackage.version = "0.9.0";
  fs.writeFileSync(
    previousPackagePath,
    `${JSON.stringify(previousPackage, null, 2)}\n`,
  );
  fs.appendFileSync(
    path.join(previousSource, "templates", "AGENTS.destination.md"),
    "\n<!-- package-acceptance previous contract -->\n",
  );

  const previousTarball = npmPack(previousSource, artifacts);
  const currentTarball = npmPack(repositoryRoot, artifacts);
  const yamlTarball = npmPack(
    path.join(repositoryRoot, "node_modules", "yaml"),
    artifacts,
  );

  fs.mkdirSync(runner, { recursive: true });
  fs.writeFileSync(
    path.join(runner, "package.json"),
    '{"name":"skillsmithy-package-runner","private":true}\n',
  );
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      previousTarball,
      yamlTarball,
    ],
    runner,
  );
  runNpm(
    [
      "exec",
      "--",
      "skillsmithy",
      "mint",
      "minted-skill",
      "--out-dir",
      destination,
    ],
    runner,
    {
      SKILL_SMITHY_TEST_PACKAGE_SPEC: `file:${toPortable(previousTarball)}`,
    },
  );

  assertDestinationIgnores(destination);
  assertInstalledPackageRefusesDirectInvocation(runner);

  const canonicalPath = path.join(
    destination,
    "skills",
    "minted-skill",
    "SKILL.md",
  );
  const canonicalBefore = fs.readFileSync(canonicalPath);
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      yamlTarball,
    ],
    destination,
  );
  runNpm(["run", "build"], destination);
  runNpm(["test"], destination);

  runNpm(
    [
      "install",
      "--save-dev",
      "--save-exact",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      currentTarball,
      yamlTarball,
    ],
    destination,
  );
  const currentSpec = `file:${toPortable(currentTarball)}`;
  runNpm(["run", "migrate", "--", "--dry-run"], destination, {
    SKILL_SMITHY_TEST_PACKAGE_SPEC: currentSpec,
  });
  runNpm(["run", "migrate"], destination, {
    SKILL_SMITHY_TEST_PACKAGE_SPEC: currentSpec,
  });
  runNpm(["test"], destination);

  if (!fs.readFileSync(canonicalPath).equals(canonicalBefore)) {
    throw new Error("Package migration changed canonical skill bytes.");
  }
  if (fs.existsSync(path.join(destination, "scripts"))) {
    throw new Error("Minted package destination contains copied Forge scripts.");
  }
  const provenance = JSON.parse(
    fs.readFileSync(
      path.join(destination, ".skillsmithy", "provenance.json"),
      "utf8",
    ),
  );
  const currentPackage = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  if (
    provenance.package !== currentPackage.name ||
    provenance.version !== currentPackage.version
  ) {
    throw new Error("Package migration did not refresh tooling provenance.");
  }
  console.log("Packed-package mint and migration acceptance test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

// npm renames a packaged `.gitignore` to `.npmignore` when it extracts a
// tarball, so a destination minted from an installed release cannot inherit
// this repository's file. Only the packed path proves the ignore template
// shipped and was used; minting from a source checkout would pass either way.
function assertDestinationIgnores(destination) {
  const ignorePath = path.join(destination, ".gitignore");
  if (!fs.existsSync(ignorePath)) {
    throw new Error("Minted package destination has no .gitignore.");
  }
  const ignored = new Set(
    fs
      .readFileSync(ignorePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim()),
  );
  for (const entry of [
    "node_modules/",
    ".claude/skills/",
    ".agents/skills/",
  ]) {
    if (!ignored.has(entry)) {
      throw new Error(
        `Minted package destination does not ignore "${entry}". A project ` +
          "that installs its tooling would commit node_modules or duplicate " +
          "discovery copies.",
      );
    }
  }
}

// Bypassing the CLI leaves no project root, and the package directory is a
// real project-shaped tree inside node_modules. Building it would write
// generated output into the dependency instead of failing.
function assertInstalledPackageRefusesDirectInvocation(runner) {
  const script = path.join(
    runner,
    "node_modules",
    "@neefactory",
    "skillsmithy",
    "scripts",
    "build.mjs",
  );
  const result = spawnSync(process.execPath, [script], {
    cwd: runner,
    encoding: "utf8",
  });
  if (result.status === 0) {
    throw new Error(
      "Running an installed script directly built the package itself instead of failing.",
    );
  }
  if (!`${result.stderr}`.includes("installed package as the project root")) {
    throw new Error(
      `Direct invocation failed without the expected explanation: ${result.stderr}`,
    );
  }
  for (const generated of [".claude-plugin", ".codex-plugin", ".claude"]) {
    const leaked = path.join(
      runner,
      "node_modules",
      "@neefactory",
      "skillsmithy",
      generated,
    );
    if (fs.existsSync(leaked)) {
      throw new Error(`Direct invocation generated ${generated} inside the package.`);
    }
  }
}

function npmPack(source, destination) {
  const before = new Set(fs.readdirSync(destination));
  runNpm(
    ["pack", source, "--pack-destination", destination, "--silent"],
    repositoryRoot,
  );
  const created = fs
    .readdirSync(destination)
    .filter((name) => name.endsWith(".tgz") && !before.has(name));
  if (created.length !== 1) {
    throw new Error(
      `Expected npm pack to create one tarball, found: ${created.join(", ")}`,
    );
  }
  return path.join(destination, created[0]);
}

function copyPackageSource(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(candidate) {
      const relative = path.relative(source, candidate);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return ![
        ".git",
        "node_modules",
        ".claude",
        ".agents",
        ".claude-plugin",
        ".codex-plugin",
        ".github",
      ].includes(first);
    },
  });
}

function runNpm(
  args,
  cwd,
  extraEnv = {},
) {
  const windowsNpmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const command =
    process.platform === "win32" && fs.existsSync(windowsNpmCli)
      ? process.execPath
      : "npm";
  const commandArgs =
    command === process.execPath ? [windowsNpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(temporaryRoot, "npm-cache"),
      ...extraEnv,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
  return result;
}

function toPortable(value) {
  return value.split(path.sep).join("/");
}
