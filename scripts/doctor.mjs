import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, validateProject } from "./lib.mjs";

const result = validateProject(ROOT);
const config = result.project?.config;

console.log("Skill Smithy doctor");
console.log("==================");

for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
for (const error of result.errors) console.error(`FAIL  ${error}`);

if (!result.errors.length) console.log("PASS  Project and skill schemas");

if (config?.template) {
  console.log("INFO  Repository is a pristine project source.");
  console.log(
    "NEXT  Run `npm run mint -- <skill-name> --out-dir <path>` for a new independent project.",
  );
  console.log(
    "NEXT  Run `npm run import -- <skill-path> --out-dir <path>` to package an existing skill.",
  );
} else if (config) {
  reportTooling();
  const clawHubActionsMode = config.clawhub?.githubActions ?? "off";
  checkGit(config.repo, clawHubActionsMode !== "off");
  checkCommand("claude", ["--version"]);
  checkCommand("codex", ["--version"]);
  checkCommand("openclaw", ["--version"]);
  checkCommand("clawhub", ["--version"]);
  if (clawHubActionsMode !== "off") {
    checkCommand("gh", ["--version"]);
  }
  if (config.targets.hermes) {
    checkCommand("hermes", ["--version"]);
  }

  console.log("\nPublish/install commands");
  if (config.targets.claude) {
    console.log(`  Claude:  claude plugin marketplace add ${config.repo}`);
  }
  if (config.targets.codex) {
    console.log(`  Codex:   codex plugin marketplace add ${config.repo}`);
  }
  if (config.targets.openclaw && result.project) {
    console.log("  ClawHub: clawhub login   (required before publishing)");
    for (const skill of result.project.skills) {
      console.log(
        `  ClawHub: clawhub skill publish ${config.sourceDir}/${skill.directoryName} --dry-run`,
      );
      console.log(
        `  ClawHub: clawhub skill publish ${config.sourceDir}/${skill.directoryName}`,
      );
    }
    // ClawHub publishes under MIT-0, which a destination declares by default.
    // Only a project that has chosen something else needs to hear about it.
    console.log(
      config.license === "MIT-0"
        ? "  Note: license MIT-0 matches ClawHub's publishing terms."
        : `  Note: ClawHub publishes skills under MIT-0; this project declares ${config.license}.`,
    );
    if (clawHubActionsMode !== "off") {
      const branch = config.clawhub.publishBranch || "main";
      console.log(
        "  ClawHub Actions: commit .github/workflows/clawhub-publish.yml to the default branch.",
      );
      console.log(
        "  ClawHub Actions: add repository secret CLAWHUB_TOKEN before a real publish.",
      );
      console.log(
        `  ClawHub Actions: gh workflow run clawhub-publish.yml --ref ${branch}`,
      );
      if (clawHubActionsMode === "push") {
        console.log(
          `  ClawHub Actions: pushes to ${branch} that change ${config.sourceDir}/ publish automatically.`,
        );
      } else {
        console.log(
          "  ClawHub Actions: real publishes run only through workflow_dispatch.",
        );
      }
      if (config.clawhub.owner) {
        console.log(
          `  ClawHub Actions: publishes as confirmed owner ${config.clawhub.owner}.`,
        );
      } else {
        console.log(
          "  ClawHub Actions: owner is omitted, so CLAWHUB_TOKEN's authenticated user publishes.",
        );
      }
      console.log(
        "  Note: ClawHub's web GitHub import creates the first release but does not watch later pushes; this workflow performs later publishes.",
      );
    } else {
      console.log(
        '  ClawHub Actions: disabled; set clawhub.githubActions to "manual" or "push" and run npm run build to opt in.',
      );
    }
  }
  if (config.targets.hermes && result.project) {
    // One install syntax covers both cases: adding the tap makes the
    // repository discoverable, but the install path is identical either way.
    console.log(`  Hermes tap:     hermes skills tap add ${config.repo}`);
    for (const skill of result.project.skills) {
      console.log(
        `  Hermes install: hermes skills install ${config.repo}/${config.sourceDir}/${skill.directoryName}`,
      );
    }
    if (config.sourceDir !== "skills") {
      console.log(
        `  Note: Hermes taps default to a skills/ subtree; installers must set ` +
          `"path": "${config.sourceDir}" in ~/.hermes/.hub/taps.json.`,
      );
    }
  }
}

if (result.errors.length) process.exitCode = 1;

// Project commands come from the pinned development dependency, so a pin that
// is not installed is the difference between a working project and a confusing
// npm error. This deliberately asks the filesystem rather than the registry: a
// release cut but not yet published fails the same way, and doctor should work
// offline.
function reportTooling() {
  const provenancePath = path.join(ROOT, ".skillsmithy", "provenance.json");
  const packagePath = path.join(ROOT, "package.json");
  if (!fs.existsSync(provenancePath) || !fs.existsSync(packagePath)) return;

  let provenance;
  let packageJson;
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
    packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return;
  }

  const name = provenance.package;
  const pinned = packageJson.devDependencies?.[name];
  if (typeof name !== "string" || !pinned) return;

  const installed = path.join(ROOT, "node_modules", ...name.split("/"), "package.json");
  if (fs.existsSync(installed)) {
    console.log(`PASS  Skill Smithy tooling ${name}@${pinned} is installed`);
  } else {
    console.warn(
      `WARN  ${name}@${pinned} is not installed; run \`npm install\`. ` +
        "If that release is not on the registry yet, install the version you have.",
    );
  }
}

function checkGit(expectedRepo, requiredForActions = false) {
  // Git is only needed to publish from a GitHub repository. A project kept
  // local, or published another way, never needs one, so a missing repository
  // or remote is reported as information rather than as a problem. A remote
  // that disagrees with skill.config.json is a real inconsistency and still
  // warns.
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (inside.status !== 0) {
    const message =
      "Not a Git repository; required before GitHub Actions can publish.";
    if (requiredForActions) console.warn(`WARN  ${message}`);
    else console.log("INFO  Not a Git repository; only needed to publish from GitHub.");
    return;
  }
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (remote.status !== 0 || !remote.stdout.trim()) {
    if (requiredForActions) {
      console.warn(
        "WARN  No Git remote origin; GitHub Actions publishing requires a pushed GitHub repository.",
      );
    } else {
      console.log(
        "INFO  No Git remote origin; add one when you publish to GitHub.",
      );
    }
  } else if (!remote.stdout.includes(expectedRepo)) {
    console.warn(
      `WARN  Git origin does not appear to match configured repo ${expectedRepo}.`,
    );
  } else {
    console.log("PASS  Git origin matches skill.config.json");
  }
}

function checkCommand(command, args) {
  // A shell is needed to resolve Windows `.cmd` shims, and Node deprecates
  // passing a separate args array alongside `shell: true` (DEP0190). Both
  // values are internal literals, so a single command string is safe here.
  const resultValue = spawnSync([command, ...args].join(" "), {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  });
  if (resultValue.status === 0) {
    const version = (resultValue.stdout || resultValue.stderr).trim().split(/\r?\n/)[0];
    console.log(`PASS  ${command}${version ? ` (${version})` : ""}`);
  } else {
    console.warn(`INFO  ${command} is unavailable; vendor validation is optional locally.`);
  }
}
