import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./generate.mjs";
import {
  DEFAULT_DESTINATION_TEST_SCRIPT,
  DESTINATION_SCRIPTS,
  PACKAGE_ROOT,
  ROOT,
  assertGeneratedPathsWritable,
  ensureDestinationIgnores,
  loadConfig,
  writeJson,
} from "./lib.mjs";

const PROVENANCE_SCHEMA_VERSION = 1;
const PROVENANCE_PATH = path.join(".skillsmithy", "provenance.json");
const BASELINE_ROOT = path.join(".skillsmithy", "baseline");
const TEST_PACKAGE_SPEC_ENV = "SKILL_SMITHY_TEST_PACKAGE_SPEC";

export function readForgePackage(packageRoot = PACKAGE_ROOT) {
  const packagePath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (!packageJson.name || !packageJson.version) {
    throw new Error(
      `${packagePath} must declare a package name and version before minting or migrating.`,
    );
  }
  return packageJson;
}

export function writeDestinationPackage(
  projectRoot,
  packageRoot = PACKAGE_ROOT,
) {
  const config = loadConfig(projectRoot);
  const forgePackage = readForgePackage(packageRoot);
  const packagePath = path.join(projectRoot, "package.json");
  const existing = fs.existsSync(packagePath)
    ? JSON.parse(fs.readFileSync(packagePath, "utf8"))
    : {};
  const dependencySpec =
    process.env[TEST_PACKAGE_SPEC_ENV] || forgePackage.version;

  // Only `name`, `version`, the Skill Smithy scripts, and the tooling
  // dependency are managed: they are derived from skill.config.json and the
  // installed package, so a migration must be able to refresh them. Everything
  // else belongs to the project. Fields are seeded when absent and never
  // rewritten, because a migration that silently reverted a project's own
  // `test` script, `files` list, or `private` flag would be a worse bug than
  // whatever it was upgrading.
  const packageJson = {
    ...existing,
    name: config.pluginName,
    private: existing.private ?? true,
    description:
      existing.description ??
      `Portable Agent Skill project for ${config.pluginName}.`,
    version: config.version,
    type: existing.type ?? "module",
    license: existing.license ?? config.license,
    engines: existing.engines ?? forgePackage.engines,
    scripts: {
      ...(existing.scripts ?? {}),
      ...DESTINATION_SCRIPTS,
    },
    devDependencies: {
      ...(existing.devDependencies ?? {}),
      [forgePackage.name]: dependencySpec,
    },
  };
  packageJson.scripts.test ??= DEFAULT_DESTINATION_TEST_SCRIPT;

  writeJson(packagePath, packageJson);
  return {
    packageName: forgePackage.name,
    packageVersion: forgePackage.version,
    dependencySpec,
  };
}

export function writeDestinationProvenance(
  projectRoot,
  packageRoot = PACKAGE_ROOT,
) {
  const forgePackage = readForgePackage(packageRoot);
  const managedFiles = desiredManagedFiles(packageRoot);
  writeProvenance(projectRoot, forgePackage, managedFiles);
}

export function planMigration(
  projectRoot,
  packageRoot = PACKAGE_ROOT,
) {
  const config = loadConfig(projectRoot);
  if (config.template) {
    throw new Error(
      "migrate must run inside a destination previously created by Skill Smithy.",
    );
  }

  const forgePackage = readForgePackage(packageRoot);
  const desired = desiredManagedFiles(packageRoot);
  const previous = readProvenance(projectRoot);
  if (previous && previous.package !== forgePackage.name) {
    throw new Error(
      `${PROVENANCE_PATH}: package "${previous.package}" cannot be migrated by "${forgePackage.name}".`,
    );
  }
  const managed = [];
  const conflicts = [];

  for (const [relativePath, desiredContent] of desired) {
    const currentPath = path.join(projectRoot, relativePath);
    const currentContent = fs.existsSync(currentPath)
      ? fs.readFileSync(currentPath)
      : null;
    const previousEntry = previous?.managedFiles?.[toPortable(relativePath)];
    const baselineContent = previousEntry
      ? readBaseline(projectRoot, previousEntry)
      : null;
    const action = classifyManagedFile({
      previous,
      currentContent,
      baselineContent,
      desiredContent,
    });
    const item = { path: toPortable(relativePath), action };
    managed.push(item);
    if (action === "conflict") conflicts.push(item);
  }

  return {
    projectRoot,
    packageRoot,
    fromVersion: previous?.version ?? null,
    toVersion: forgePackage.version,
    packageName: forgePackage.name,
    bootstrap: !previous,
    managed,
    conflicts,
    desired,
    forgePackage,
  };
}

export function migrateProject(
  projectRoot,
  packageRoot = PACKAGE_ROOT,
  { dryRun = false } = {},
) {
  const plan = planMigration(projectRoot, packageRoot);
  if (plan.conflicts.length) {
    const paths = plan.conflicts.map((item) => item.path).join(", ");
    throw new Error(
      `Migration has locally modified managed-file conflicts: ${paths}. ` +
        "Reconcile those files against the new Skill Smithy package, then rerun the dry-run.",
    );
  }
  if (dryRun) return { ...plan, applied: false };

  preflightMigration(plan);
  for (const item of plan.managed) {
    if (["create", "replace"].includes(item.action)) {
      const content = plan.desired.get(fromPortable(item.path));
      const target = checkedInside(projectRoot, item.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  ensureDestinationIgnores(projectRoot, packageRoot);
  writeDestinationPackage(projectRoot, packageRoot);
  buildProject(projectRoot, projectRoot);
  writeProvenance(projectRoot, plan.forgePackage, plan.desired);
  return { ...plan, applied: true };
}

function preflightMigration(plan) {
  assertGeneratedPathsWritable(plan.projectRoot);
  for (const item of plan.managed) {
    const target = checkedInside(plan.projectRoot, item.path);
    const writable = fs.existsSync(target) ? target : existingParent(target);
    fs.accessSync(writable, fs.constants.W_OK);
  }

  const previewRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "skillsmithy-migrate-preview-"),
  );
  try {
    buildProject(plan.projectRoot, previewRoot);
  } finally {
    fs.rmSync(previewRoot, { recursive: true, force: true });
  }
}

function classifyManagedFile({
  previous,
  currentContent,
  baselineContent,
  desiredContent,
}) {
  if (!previous) {
    if (currentContent == null) return "create";
    return currentContent.equals(desiredContent) ? "unchanged" : "preserve";
  }
  if (currentContent == null) {
    return baselineContent?.equals(desiredContent) ? "preserve" : "conflict";
  }
  if (currentContent.equals(desiredContent)) return "unchanged";
  if (baselineContent == null) return "conflict";
  if (currentContent.equals(baselineContent)) return "replace";
  if (desiredContent.equals(baselineContent)) return "preserve";
  return "conflict";
}

function desiredManagedFiles(packageRoot) {
  const candidates = new Map([
    ["AGENTS.md", path.join(packageRoot, "templates", "AGENTS.destination.md")],
    ["CLAUDE.md", path.join(packageRoot, "CLAUDE.md")],
    [
      "skill.config.schema.json",
      path.join(packageRoot, "skill.config.schema.json"),
    ],
  ]);
  const result = new Map();
  for (const [relativePath, source] of candidates) {
    if (fs.existsSync(source)) {
      result.set(relativePath, fs.readFileSync(source));
    }
  }
  return result;
}

function readProvenance(projectRoot) {
  const provenancePath = path.join(projectRoot, PROVENANCE_PATH);
  if (!fs.existsSync(provenancePath)) return null;
  const value = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  if (value.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    throw new Error(
      `${PROVENANCE_PATH}: unsupported schemaVersion ${value.schemaVersion}.`,
    );
  }
  return value;
}

function writeProvenance(projectRoot, forgePackage, managedFiles) {
  const baselineRoot = checkedInside(projectRoot, BASELINE_ROOT);
  fs.rmSync(baselineRoot, { recursive: true, force: true });
  fs.mkdirSync(baselineRoot, { recursive: true });
  const entries = {};
  for (const [relativePath, content] of managedFiles) {
    const baseline = path.join(BASELINE_ROOT, relativePath);
    const target = checkedInside(projectRoot, baseline);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    entries[toPortable(relativePath)] = {
      sha256: sha256(content),
      baseline: toPortable(baseline),
    };
  }
  writeJson(path.join(projectRoot, PROVENANCE_PATH), {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    package: forgePackage.name,
    version: forgePackage.version,
    managedFiles: entries,
  });
}

function readBaseline(projectRoot, entry) {
  if (
    typeof entry.baseline !== "string" ||
    !entry.baseline.startsWith(".skillsmithy/baseline/")
  ) {
    throw new Error(`${PROVENANCE_PATH}: invalid managed-file baseline path.`);
  }
  const target = checkedInside(projectRoot, entry.baseline);
  if (!fs.existsSync(target)) return null;
  const content = fs.readFileSync(target);
  if (sha256(content) !== entry.sha256) {
    throw new Error(
      `${toPortable(entry.baseline)} differs from its recorded provenance hash; restore it before migrating.`,
    );
  }
  return content;
}

function checkedInside(projectRoot, relativePath) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, fromPortable(relativePath));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Migration path escapes the project: ${relativePath}`);
  }
  return target;
}

function existingParent(target) {
  let current = path.dirname(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function toPortable(value) {
  return value.split(path.sep).join("/");
}

function fromPortable(value) {
  return value.split("/").join(path.sep);
}

function printPlan(result) {
  const from = result.fromVersion ?? "pre-provenance project";
  console.log(
    `${result.applied ? "Migrated" : "Migration preview"}: ${from} -> ${result.toVersion}`,
  );
  for (const item of result.managed) {
    console.log(`  ${item.action.padEnd(9)} ${item.path}`);
  }
  console.log("  refresh   package.json and generated adapters");
  if (!result.applied) console.log("Dry run: no files were written.");
}

function parseArguments(args) {
  const options = { dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    printPlan(migrateProject(ROOT, PACKAGE_ROOT, options));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
