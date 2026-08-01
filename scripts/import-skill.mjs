import fs from "node:fs";
import path from "node:path";
import {
  NAME_PATTERN,
  copyTree,
  listSkillNames,
  loadConfig,
  parseSkillFile,
  toDisplayName,
  validateProject,
  writeJson,
} from "./lib.mjs";

// Documentation that describes a repository rather than the skill itself.
// These are placed at the project root so they are never copied into the
// generated discovery trees and distributed alongside the skill payload.
const PROJECT_DOC_NAMES = new Set([
  "readme.md",
  "contributing.md",
  "changelog.md",
]);

// A licence beside SKILL.md is usually deliberate, so its terms travel with
// the distributed skill. Import reports it and moves nothing.
const LICENCE_PATTERN = /^licen[sc]e(\.md|\.txt)?$/;

export function importSkill(
  root,
  input,
  { bundleName = null, dryRun = false, freshProject = false } = {},
) {
  if (!input) throw new Error("An existing SKILL.md file or skill directory is required.");
  if (bundleName) assertName(bundleName, "bundle plugin name");

  const config = loadConfig(root);
  const source = inspectSource(input);
  assertName(source.name, "imported skill frontmatter name");

  const sourceRoot = path.resolve(root, config.sourceDir);
  if (isInside(sourceRoot, source.inputPath)) {
    throw new Error(
      `Import source must be outside ${config.sourceDir}/ so the canonical copy ` +
        "cannot overlap or replace the supplied skill.",
    );
  }
  if (source.kind === "directory" && isInside(source.inputPath, root)) {
    throw new Error(
      "Import source must not contain the Skill Smithy repository because staging would overlap the supplied directory.",
    );
  }

  validateSafeLinks(source);
  const destination = path.join(sourceRoot, source.name);
  if (fs.existsSync(destination)) {
    throw new Error(`Skill "${source.name}" already exists.`);
  }

  const transition = planTransition(root, config, bundleName);
  const projectDocs = planProjectDocs(source, root, freshProject);
  const hoisted = new Set(
    projectDocs.filter((doc) => doc.action === "hoist").map((doc) => doc.name),
  );
  const plan = {
    source: source.inputPath,
    sourceSkillFile: source.skillPath,
    sourceKind: source.kind,
    name: source.name,
    destination,
    mode: transition.mode,
    pluginName: transition.pluginName,
    sourceDirName: config.sourceDir,
    projectDocs,
    dryRun,
  };
  if (dryRun) return { ...plan, imported: false, errors: [], warnings: [] };

  const before = snapshotSource(source);
  const transaction = fs.mkdtempSync(path.join(root, ".skillsmithy-import-"));
  const stagedSkill = path.join(transaction, "skill");
  const stagedDocs = path.join(transaction, "project-docs");
  const configPath = path.join(root, "skill.config.json");
  const originalConfig = fs.readFileSync(configPath);
  let installed = false;
  let installedDocs = [];
  let exampleBackup = null;

  try {
    copySource(source, stagedSkill, hoisted);
    assertCopyMatches(source, stagedSkill, withoutEntries(before, hoisted));
    stageProjectDocs(source, stagedDocs, hoisted, before);

    fs.mkdirSync(sourceRoot, { recursive: true });
    if (transition.examplePath) {
      exampleBackup = path.join(transaction, "example-skill");
      fs.renameSync(transition.examplePath, exampleBackup);
    }

    fs.renameSync(stagedSkill, destination);
    installed = true;
    installedDocs = installProjectDocs(stagedDocs, root, hoisted);
    applyConfig(config, source, transition);
    writeJson(configPath, config);

    const after = snapshotSource(source);
    assertSnapshotsEqual(before, after, "Import source changed during import.");

    const validation = validateProject(root);
    return {
      ...plan,
      imported: true,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  } catch (error) {
    const rollbackErrors = [];
    try {
      for (const doc of installedDocs) {
        fs.rmSync(doc, { force: true });
      }
      if (installed && fs.existsSync(destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      if (exampleBackup && fs.existsSync(exampleBackup)) {
        fs.renameSync(exampleBackup, transition.examplePath);
      }
      fs.writeFileSync(configPath, originalConfig);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Import failed and rollback was incomplete. Recovery data remains at ${transaction}`,
      );
    }
    throw error;
  } finally {
    if (fs.existsSync(transaction)) {
      fs.rmSync(transaction, { recursive: true, force: true });
    }
  }
}

function inspectSource(input) {
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Import source does not exist: ${inputPath}`);
  }
  const stat = fs.lstatSync(inputPath);
  let skillPath;
  let kind;

  if (stat.isFile()) {
    if (path.basename(inputPath).toLowerCase() !== "skill.md") {
      throw new Error("A file import must be named SKILL.md (case-insensitive).");
    }
    skillPath = inputPath;
    kind = "file";
  } else if (stat.isDirectory()) {
    const matches = fs
      .readdirSync(inputPath, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.toLowerCase() === "skill.md",
      );
    if (matches.length !== 1) {
      throw new Error(
        `A skill directory must contain exactly one root SKILL.md ` +
          `(case-insensitive); found ${matches.length}.`,
      );
    }
    skillPath = path.join(inputPath, matches[0].name);
    kind = "directory";
  } else {
    throw new Error("Import source must be a regular file or directory.");
  }

  let parsed;
  try {
    parsed = parseSkillFile(skillPath);
  } catch (error) {
    throw new Error(`${skillPath}: ${error.message}`);
  }

  return {
    inputPath,
    skillPath,
    skillFileName: path.basename(skillPath),
    kind,
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
  };
}

// Root-level files only. A document nested inside references/ or assets/ is
// part of the skill and is never reclassified.
function planProjectDocs(source, root, freshProject) {
  if (source.kind !== "directory") return [];

  const docs = [];
  const claimed = new Set();
  for (const entry of fs.readdirSync(source.inputPath, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === source.skillFileName) continue;
    const lower = entry.name.toLowerCase();

    if (LICENCE_PATTERN.test(lower)) {
      docs.push({ name: entry.name, action: "notice" });
      continue;
    }
    if (!PROJECT_DOC_NAMES.has(lower)) continue;

    if (claimed.has(lower)) {
      docs.push({
        name: entry.name,
        action: "keep",
        reason: `another supplied file already claims ${lower}`,
      });
      continue;
    }
    claimed.add(lower);

    if (!freshProject && fs.existsSync(path.join(root, entry.name))) {
      docs.push({
        name: entry.name,
        action: "keep",
        reason: `the project root already has ${entry.name}`,
      });
      continue;
    }
    docs.push({ name: entry.name, action: "hoist" });
  }
  return docs.sort((left, right) => left.name.localeCompare(right.name));
}

// Shared by every entry point so one import reports the same placement
// decisions whether it ran through mint, import, or add-skill.
export function describeProjectDocs(result) {
  const skillPath = `${result.sourceDirName ?? "skills"}/${result.name}/`;
  const notes = [];
  for (const doc of result.projectDocs ?? []) {
    if (doc.action === "hoist") {
      notes.push(
        result.dryRun
          ? `Would place ${doc.name} at the project root instead of ${skillPath}.`
          : `Placed ${doc.name} at the project root; it is not distributed with the skill.`,
      );
    } else if (doc.action === "keep") {
      notes.push(
        `${result.dryRun ? "Would keep" : "Kept"} ${doc.name} in ${skillPath} ` +
          `because ${doc.reason}. Move it yourself if it documents the project.`,
      );
    } else {
      notes.push(
        `${result.dryRun ? "Would leave" : "Left"} ${doc.name} in ${skillPath}. ` +
          "A licence beside SKILL.md usually ships with the skill on purpose; " +
          "copy it to the project root if it covers the repository.",
      );
    }
  }
  return notes;
}

function planTransition(root, config, bundleName) {
  const names = listSkillNames(root, config.sourceDir);
  if (config.template) {
    if (bundleName) {
      throw new Error(
        "Import the first skill in single mode; use --bundle only when importing a second cohesive skill.",
      );
    }
    if (names.length !== 1 || names[0] !== "example-skill") {
      throw new Error("Template import expects only skills/example-skill.");
    }
    return {
      mode: "single",
      pluginName: null,
      examplePath: path.join(root, config.sourceDir, "example-skill"),
    };
  }

  if (config.mode === "single") {
    if (!bundleName) {
      throw new Error(
        "Importing a second skill is intentional: pass --bundle <plugin-name> " +
          "to confirm both skills should be installed and versioned together.",
      );
    }
    return { mode: "bundle", pluginName: bundleName, examplePath: null };
  }

  if (bundleName && bundleName !== config.pluginName) {
    throw new Error(
      `This bundle is already named "${config.pluginName}"; received "${bundleName}".`,
    );
  }
  return {
    mode: "bundle",
    pluginName: config.pluginName,
    examplePath: null,
  };
}

function applyConfig(config, source, transition) {
  const displayName = toDisplayName(source.name);
  const description = usableDescription(source.description, displayName);
  const shortDescription = shorten(description);

  if (config.template) {
    config.template = false;
    config.mode = "single";
    config.pluginName = source.name;
    config.displayName = displayName;
    config.shortDescription = shortDescription;
    config.description = description;
    config.defaultPrompt = `Use $${source.name} for a supported request.`;
    config.marketplaceName = source.name;
    config.marketplaceDisplayName = displayName;
    config.marketplaceDescription = description;
    config.$comment =
      "Imported skill files are preserved byte-for-byte. Edit only with explicit user approval; validation reports do not rewrite them.";
    return;
  }

  if (transition.mode === "bundle" && config.mode === "single") {
    config.mode = "bundle";
    config.pluginName = transition.pluginName;
    config.displayName = toDisplayName(transition.pluginName);
    config.marketplaceName = transition.pluginName;
    config.marketplaceDisplayName = toDisplayName(transition.pluginName);
  }
}

function usableDescription(value, displayName) {
  if (typeof value !== "string" || !value.trim()) {
    return `Imported ${displayName} skill. Review its validation findings before publishing.`;
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 1024);
}

function shorten(value) {
  if (value.length >= 25 && value.length <= 64) return value;
  if (value.length > 64) return `${value.slice(0, 61).trimEnd()}...`;
  return "Imported skill workflow and guidance";
}

function copySource(source, destination, hoisted = new Set()) {
  if (source.kind === "file") {
    fs.mkdirSync(destination, { recursive: true });
    copyTree(source.skillPath, path.join(destination, "SKILL.md"));
    return;
  }

  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source.inputPath)) {
    if (hoisted.has(entry)) continue;
    const outputName =
      entry === source.skillFileName ? "SKILL.md" : entry;
    copyTree(
      path.join(source.inputPath, entry),
      path.join(destination, outputName),
    );
  }
}

// Hoisted documents leave the skill directory but must still arrive
// byte-for-byte, so they are staged and verified exactly like skill content.
function stageProjectDocs(source, stagedDocs, names, expected) {
  if (!names.size) return;
  fs.mkdirSync(stagedDocs, { recursive: true });
  for (const name of names) {
    const staged = path.join(stagedDocs, name);
    copyTree(path.join(source.inputPath, name), staged);
    if (!sameEntry(expected.get(name), snapshotEntry(staged))) {
      throw new Error(
        `Staged copy of ${name} was not byte-for-byte identical.`,
      );
    }
  }
}

function installProjectDocs(stagedDocs, root, names) {
  const installed = [];
  for (const name of names) {
    const target = path.join(root, name);
    fs.renameSync(path.join(stagedDocs, name), target);
    installed.push(target);
  }
  return installed;
}

function withoutEntries(snapshot, names) {
  if (!names.size) return snapshot;
  const remaining = new Map(snapshot);
  for (const name of names) remaining.delete(name);
  return remaining;
}

function validateSafeLinks(source) {
  if (source.kind !== "directory") return;
  const root = path.resolve(source.inputPath);
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(absolute);
        if (path.isAbsolute(target) || !isInside(root, path.resolve(current, target))) {
          throw new Error(
            `Unsafe symlink ${path.relative(root, absolute)} points outside the imported skill.`,
          );
        }
      } else if (stat.isDirectory()) {
        visit(absolute);
      }
    }
  };
  visit(root);
}

function snapshotSource(source) {
  if (source.kind === "file") {
    return new Map([["SKILL.md", snapshotEntry(source.skillPath)]]);
  }
  return snapshotTree(source.inputPath, source.skillFileName);
}

function snapshotDestination(destination) {
  return snapshotTree(destination, "SKILL.md");
}

function snapshotTree(root, skillFileName) {
  const entries = new Map();
  const visit = (current, relativePath) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      entries.set(relativePath, {
        type: "link",
        target: fs.readlinkSync(current),
      });
      return;
    }
    if (stat.isDirectory()) {
      if (relativePath !== "") {
        entries.set(`${relativePath}/`, {
          type: "directory",
          mode: modeOf(stat),
        });
      }
      for (const name of fs.readdirSync(current).sort()) {
        const outputName =
          relativePath === "" && name === skillFileName ? "SKILL.md" : name;
        visit(path.join(current, name), path.join(relativePath, outputName));
      }
      return;
    }
    entries.set(relativePath, snapshotEntry(current));
  };
  visit(root, "");
  return entries;
}

function snapshotEntry(filePath) {
  const stat = fs.lstatSync(filePath);
  return {
    type: "file",
    mode: modeOf(stat),
    contents: fs.readFileSync(filePath),
  };
}

function modeOf(stat) {
  return process.platform === "win32" ? 0 : stat.mode & 0o777;
}

function assertCopyMatches(source, destination, expected) {
  const actual = snapshotDestination(destination);
  assertSnapshotsEqual(
    expected,
    actual,
    `Staged copy of ${source.inputPath} was not byte-for-byte identical.`,
  );
}

function assertSnapshotsEqual(left, right, message) {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    const a = left.get(key);
    const b = right.get(key);
    if (!sameEntry(a, b)) throw new Error(`${message} Difference: ${key}`);
  }
}

function sameEntry(left, right) {
  if (!left || !right || left.type !== right.type || left.mode !== right.mode) {
    return false;
  }
  if (left.type === "file") return left.contents.equals(right.contents);
  if (left.type === "link") return left.target === right.target;
  return true;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function assertName(value, label) {
  if (typeof value !== "string" || !NAME_PATTERN.test(value) || value.length > 64) {
    throw new Error(
      `${label} must be 1-64 lowercase letters, numbers, or single hyphens. ` +
        "The importer will not rewrite it.",
    );
  }
}
