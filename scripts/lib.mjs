import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const ROOT = process.env.SKILL_SMITHY_PROJECT_ROOT
  ? path.resolve(process.env.SKILL_SMITHY_PROJECT_ROOT)
  : PACKAGE_ROOT;

// These exact paths are generated. Parent directories may contain user-owned
// settings, hooks, agents, or plugins and must never be removed wholesale.
export const GENERATED_PATHS = [
  ".claude/skills",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".agents/skills",
  ".agents/plugins/marketplace.json",
  ".codex-plugin/plugin.json",
  ".github/workflows/clawhub-publish.yml",
];

// Discovery copies register the skill with the agent it is authored in. A
// project is expected to ignore them, because a marketplace importer scanning
// the repository would otherwise find three copies of SKILL.md instead of one.
export const GENERATED_DISCOVERY_PATHS = [".claude/skills", ".agents/skills"];

// Every other generated path is a manifest or workflow that an installer,
// marketplace, or GitHub Actions resolves from the committed repository.
// Ignoring one is a packaging mistake rather than a choice: the build still
// writes it, drift detection still passes because it skips ignored paths, and
// nothing fails until a consumer cannot find the file.
export const GENERATED_TRACKED_PATHS = GENERATED_PATHS.filter(
  (relativePath) => !GENERATED_DISCOVERY_PATHS.includes(relativePath),
);

// The npm scripts every destination exposes. `mint` and `migrate` write this
// map and `validateToolingState` enforces it, so the writer and the validator
// cannot drift apart.
export const DESTINATION_SCRIPTS = {
  "add-skill": "skillsmithy add-skill",
  build: "skillsmithy build",
  validate: "skillsmithy validate",
  check: "skillsmithy check",
  doctor: "skillsmithy doctor",
  migrate: "skillsmithy migrate",
};

// A starting point rather than a managed file. A project that wires evals or
// extra checks into `npm test` keeps its own version across migrations, so
// this is written only when the script is absent and is never validated.
export const DEFAULT_DESTINATION_TEST_SCRIPT =
  "npm run validate && npm run check";

// A destination's ignore file is a template asset rather than a copy of this
// checkout's own `.gitignore`. npm renames a packaged `.gitignore` to
// `.npmignore` when it extracts a tarball, so an installed release has no such
// file to copy, and a destination minted from the published package would
// silently lose `node_modules/` — the one entry a dependency-managed project
// cannot do without.
export const DESTINATION_GITIGNORE_TEMPLATE = "templates/.gitignore.destination";

const MANAGED_IGNORE_COMMENT = "# Added by `skillsmithy migrate`.";

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Keywords are prose-facing discovery terms rather than identifiers, so single
// interior spaces are allowed where names permit only hyphens.
export const KEYWORD_PATTERN = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;
export const KEYWORD_LIMIT = 12;
export const SEMVER_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Advisory only. These match the exact strings the scaffold writes, so an
// author is reminded of unfinished work without the tooling second-guessing
// legitimate skill content. Publishing readiness is the author's call.
const PLACEHOLDER_PATTERNS = [
  /TODO:/,
  /your-handle/,
  /your-repo/,
  /you@example\.com/,
  /\bYour Name\b/,
];

export function loadConfig(root = ROOT) {
  assertResolvedRoot(root);
  const configPath = path.join(root, "skill.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

// `ROOT` falls back to the package's own directory when no project root is
// supplied, which is correct for `mint` and `import` and for a development
// checkout. For an installed release that directory is real and carries a
// template `skill.config.json`, so bypassing the CLI — `node
// node_modules/@neefactory/skillsmithy/scripts/build.mjs` — would otherwise
// succeed while writing generated output into the dependency. The CLI always
// announces which root it meant, so silence here means nobody chose one.
function assertResolvedRoot(root) {
  if (
    process.env.SKILL_SMITHY_PROJECT_ROOT ||
    process.env.SKILL_SMITHY_TEMPLATE_ROOT ||
    !samePath(root, PACKAGE_ROOT) ||
    !isInsideNodeModules(PACKAGE_ROOT)
  ) {
    return;
  }
  throw new Error(
    "Skill Smithy resolved its own installed package as the project root. " +
      "Run project commands through the CLI so they target your project: " +
      "`npm run build` inside the project, or `npm exec -- skillsmithy build`.",
  );
}

function isInsideNodeModules(target) {
  return path.resolve(target).split(path.sep).includes("node_modules");
}

export function readDestinationIgnore(packageRoot = PACKAGE_ROOT) {
  const source = path.join(
    packageRoot,
    ...DESTINATION_GITIGNORE_TEMPLATE.split("/"),
  );
  if (!fs.existsSync(source)) {
    throw new Error(
      `Template is missing ${DESTINATION_GITIGNORE_TEMPLATE}, the ignore file ` +
        "every destination receives as its .gitignore.",
    );
  }
  return fs.readFileSync(source, "utf8");
}

export function writeDestinationIgnore(root, packageRoot = PACKAGE_ROOT) {
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    readDestinationIgnore(packageRoot),
  );
}

// Migration adds entries a newer release introduced without disturbing the
// order, comments, or additions the project made to its own file.
export function ensureDestinationIgnores(root, packageRoot = PACKAGE_ROOT) {
  const target = path.join(root, ".gitignore");
  if (!fs.existsSync(target)) {
    writeDestinationIgnore(root, packageRoot);
    return;
  }

  const current = fs.readFileSync(target, "utf8");
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const present = new Set(lines.map(normalizeIgnoreEntry).filter(Boolean));
  const missing = readDestinationIgnore(packageRoot)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((entry) => !present.has(normalizeIgnoreEntry(entry)));
  if (!missing.length) return;

  if (lines.length) lines.push("");
  lines.push(MANAGED_IGNORE_COMMENT, ...missing);
  fs.writeFileSync(target, `${lines.join(newline)}${newline}`);
}

function normalizeIgnoreEntry(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  return trimmed.replace(/\/$/, "");
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function toDisplayName(name) {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function listSkillNames(root, sourceDir) {
  const base = resolveInside(root, sourceDir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(base, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

export function parseSkillFile(skillPath) {
  const raw = fs.readFileSync(skillPath);
  const text = raw.toString("utf8").replace(/^\uFEFF/, "");
  const match = text.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/,
  );
  if (!match) {
    throw new Error("SKILL.md must start with YAML frontmatter delimited by ---");
  }

  const document = parseDocument(match[1], {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }

  const frontmatter = document.toJS({ mapAsMap: false });
  if (!frontmatter || Array.isArray(frontmatter) || typeof frontmatter !== "object") {
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  }

  return { raw, text, frontmatter, body: match[2] };
}

export function readProject(root = ROOT) {
  const config = loadConfig(root);
  const names = listSkillNames(root, config.sourceDir);
  const skills = names.map((directoryName) => {
    const directory = resolveInside(root, config.sourceDir, directoryName);
    const skillPath = path.join(directory, "SKILL.md");
    let parsed;
    try {
      parsed = parseSkillFile(skillPath);
    } catch (error) {
      throw new Error(`${relative(root, skillPath)}: ${error.message}`);
    }
    return {
      directoryName,
      directory,
      skillPath,
      ...parsed,
    };
  });
  return { root, config, skills };
}

export function validateProject(root = ROOT) {
  const errors = [];
  const warnings = [];
  let project;

  try {
    project = readProject(root);
  } catch (error) {
    errors.push(error.message);
    return { errors, warnings, project: null };
  }

  validateConfig(project.root, project.config, errors);
  validatePackageIdentity(project.root, project.config, errors);
  validateToolingState(project.root, project.config, errors, warnings);

  if (!project.skills.length) {
    errors.push(`No skills found under ${project.config.sourceDir}/`);
  }

  if (project.config.mode === "single" && project.skills.length !== 1) {
    errors.push(
      `mode "single" requires exactly one skill; found ${project.skills.length}. ` +
        "Use `npm run add-skill -- <name> --bundle <plugin-name>` for a cohesive bundle.",
    );
  }

  if (
    project.config.mode === "single" &&
    project.skills.length === 1 &&
    project.config.pluginName !== project.skills[0].directoryName
  ) {
    errors.push(
      `In single mode, pluginName "${project.config.pluginName}" must match ` +
        `the skill name "${project.skills[0].directoryName}".`,
    );
  }

  // The generator already emits every canonical skill name, so a keyword that
  // restates one is dead configuration: it changes no output and hides the
  // terms that would actually widen discovery.
  if (Array.isArray(project.config.keywords)) {
    const skillNames = new Set(
      project.skills.map((skill) => skill.directoryName),
    );
    const redundant = project.config.keywords.filter((keyword) =>
      skillNames.has(keyword),
    );
    if (redundant.length) {
      errors.push(
        `skill.config.json: keyword(s) ${redundant
          .map((keyword) => `"${keyword}"`)
          .join(", ")} already reach the generated manifests from the ` +
          "canonical skill name; list only terms the name does not cover.",
      );
    }
  }

  for (const skill of project.skills) {
    validateSkill(project.root, skill, project.config, errors, warnings);
  }

  if (!project.config.template) {
    const trackedDiscoveryFiles = listTrackedDiscoveryFiles(project.root);
    if (trackedDiscoveryFiles.length) {
      const shown = trackedDiscoveryFiles
        .slice(0, 10)
        .map((file) => `"${file}"`)
        .join(", ");
      const remainder =
        trackedDiscoveryFiles.length > 10
          ? ` and ${trackedDiscoveryFiles.length - 10} more`
          : "";
      errors.push(
        `Generated discovery copies are tracked by Git: ${shown}${remainder}. ` +
          "They duplicate canonical skills for repository scanners. " +
          "Untrack .claude/skills and .agents/skills while leaving the files " +
          "locally generated and gitignored.",
      );
    }

    // The mirror of the check above: discovery copies must stay out of the
    // index, and manifests must stay in it. Only paths that exist are reported,
    // so a project with ClawHub Actions disabled is never asked about a
    // workflow it does not generate.
    for (const relativePath of ignoredGeneratedPaths(
      project.root,
      GENERATED_TRACKED_PATHS,
    )) {
      if (!fs.existsSync(path.join(project.root, relativePath))) continue;
      warnings.push(
        `${relativePath} is generated but ignored by Git. Installers and ` +
          "ClawHub read the committed file, and `npm run check` skips ignored " +
          "paths, so drift there is never reported. Remove the ignore rule " +
          "covering it and commit the file.",
      );
    }

    if (
      !project.skills.some((skill) =>
        project.config.defaultPrompt?.includes(`$${skill.directoryName}`),
      )
    ) {
      errors.push(
        "skill.config.json: defaultPrompt must mention at least one canonical skill as $skill-name.",
      );
    }

    // Advisory, like the placeholder scan below. A destination ships without a
    // LICENSE on purpose, so this reports the gap between a declared licence
    // and a file that grants it rather than deciding when a project is ready.
    if (!hasLicenseFile(root)) {
      warnings.push(
        `skill.config.json declares license "${project.config.license}" but the ` +
          "project root has no LICENSE file.",
      );
    }

    const filesToCheck = [
      path.join(root, "skill.config.json"),
      ...project.skills.flatMap((skill) => listRegularFiles(skill.directory)),
    ];
    for (const filePath of filesToCheck) {
      if (fs.statSync(filePath).size > 2 * 1024 * 1024) continue;
      const buffer = fs.readFileSync(filePath);
      if (!isUtf8TextFile(filePath, buffer)) continue;
      const text = buffer.toString("utf8");
      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (pattern.test(text)) {
          warnings.push(
            `${relative(root, filePath)} still contains scaffold placeholder text matching ${pattern}.`,
          );
          break;
        }
      }
    }
  }

  return { errors, warnings, project };
}

function hasLicenseFile(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .some(
      (entry) =>
        entry.isFile() && /^licen[cs]e(\.[a-z0-9]+)?$/i.test(entry.name),
    );
}

function validateConfig(root, config, errors) {
  const allowedConfigKeys = new Set([
    "$schema",
    "$comment",
    "template",
    "mode",
    "pluginName",
    "displayName",
    "shortDescription",
    "description",
    "defaultPrompt",
    "category",
    "keywords",
    "marketplaceName",
    "marketplaceDisplayName",
    "marketplaceDescription",
    "version",
    "license",
    "owner",
    "repo",
    "sourceDir",
    "clawhub",
    "targets",
  ]);
  for (const key of Object.keys(config)) {
    if (!allowedConfigKeys.has(key)) {
      errors.push(`skill.config.json: unknown property "${key}".`);
    }
  }

  const requiredStrings = [
    "pluginName",
    "displayName",
    "shortDescription",
    "description",
    "defaultPrompt",
    "category",
    "marketplaceName",
    "marketplaceDisplayName",
    "marketplaceDescription",
    "version",
    "license",
    "repo",
    "sourceDir",
  ];
  for (const key of requiredStrings) {
    if (typeof config[key] !== "string" || !config[key].trim()) {
      errors.push(`skill.config.json: ${key} must be a non-empty string.`);
    }
  }

  if (typeof config.template !== "boolean") {
    errors.push("skill.config.json: template must be a boolean.");
  }
  if (!["single", "bundle"].includes(config.mode)) {
    errors.push('skill.config.json: mode must be "single" or "bundle".');
  }
  for (const key of ["pluginName", "marketplaceName"]) {
    if (
      typeof config[key] === "string" &&
      (!NAME_PATTERN.test(config[key]) || config[key].length > 64)
    ) {
      errors.push(
        `skill.config.json: ${key} must be 1-64 lowercase letters, numbers, or single hyphens.`,
      );
    }
  }
  if (
    typeof config.shortDescription === "string" &&
    (config.shortDescription.length < 25 || config.shortDescription.length > 64)
  ) {
    errors.push("skill.config.json: shortDescription must be 25-64 characters.");
  }
  if (
    typeof config.description === "string" &&
    config.description.length > 1024
  ) {
    errors.push("skill.config.json: description must be at most 1024 characters.");
  }
  if (typeof config.version === "string" && !SEMVER_PATTERN.test(config.version)) {
    errors.push("skill.config.json: version must be valid semantic versioning.");
  }
  // Optional. An absent field is the documented default and generates exactly
  // what a project produced before keywords existed, so this validates only
  // what an author deliberately supplied.
  if (config.keywords != null) {
    validateKeywords(config.keywords, errors);
  }
  if (
    typeof config.repo === "string" &&
    !/^[^/\s]+\/[^/\s]+$/.test(config.repo)
  ) {
    errors.push('skill.config.json: repo must use "owner/repository" format.');
  }
  if (typeof config.sourceDir === "string") {
    try {
      resolveInside(root, config.sourceDir);
    } catch (error) {
      errors.push(`skill.config.json: ${error.message}`);
    }
  }
  validateClawHubConfig(config, errors);
  if (!config.owner || typeof config.owner !== "object") {
    errors.push("skill.config.json: owner must be an object.");
  } else {
    for (const key of Object.keys(config.owner)) {
      if (!["name", "email", "url"].includes(key)) {
        errors.push(`skill.config.json: unknown owner property "${key}".`);
      }
    }
    for (const key of ["name", "url"]) {
      if (typeof config.owner[key] !== "string" || !config.owner[key].trim()) {
        errors.push(`skill.config.json: owner.${key} must be a non-empty string.`);
      }
    }
    if (typeof config.owner.url === "string") {
      try {
        new URL(config.owner.url);
      } catch {
        errors.push("skill.config.json: owner.url must be an absolute URL.");
      }
    }
    if (config.owner.email != null) {
      if (
        typeof config.owner.email !== "string" ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.owner.email)
      ) {
        errors.push("skill.config.json: owner.email must be a valid email address.");
      }
    }
  }
  if (!config.targets || typeof config.targets !== "object") {
    errors.push("skill.config.json: targets must be an object.");
  } else {
    for (const key of Object.keys(config.targets)) {
      if (!["claude", "codex", "openclaw", "hermes"].includes(key)) {
        errors.push(`skill.config.json: unknown targets property "${key}".`);
      }
    }
    for (const key of ["claude", "codex", "openclaw", "hermes"]) {
      if (typeof config.targets[key] !== "boolean") {
        errors.push(`skill.config.json: targets.${key} must be a boolean.`);
      }
    }
  }
}

function validateClawHubConfig(config, errors) {
  if (config.clawhub == null) return;
  if (!isMapping(config.clawhub)) {
    errors.push("skill.config.json: clawhub must be an object.");
    return;
  }

  for (const key of Object.keys(config.clawhub)) {
    if (!["githubActions", "publishBranch", "owner"].includes(key)) {
      errors.push(`skill.config.json: unknown clawhub property "${key}".`);
    }
  }

  const mode = config.clawhub.githubActions;
  if (!["off", "manual", "push"].includes(mode)) {
    errors.push(
      'skill.config.json: clawhub.githubActions must be "off", "manual", or "push".',
    );
  }
  if (
    config.clawhub.publishBranch != null &&
    (typeof config.clawhub.publishBranch !== "string" ||
      !config.clawhub.publishBranch.trim() ||
      /\s/.test(config.clawhub.publishBranch) ||
      config.clawhub.publishBranch.length > 255)
  ) {
    errors.push(
      "skill.config.json: clawhub.publishBranch must be a non-empty Git ref without whitespace.",
    );
  }
  if (
    config.clawhub.owner != null &&
    (typeof config.clawhub.owner !== "string" ||
      !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(config.clawhub.owner) ||
      config.clawhub.owner.length > 64)
  ) {
    errors.push(
      "skill.config.json: clawhub.owner must be a 1-64 character lowercase publisher handle.",
    );
  }
  if (
    ["manual", "push"].includes(mode) &&
    config.targets?.openclaw !== true
  ) {
    errors.push(
      "skill.config.json: ClawHub GitHub Actions require targets.openclaw to be true.",
    );
  }
}

function validateKeywords(keywords, errors) {
  if (!Array.isArray(keywords)) {
    errors.push("skill.config.json: keywords must be an array of strings.");
    return;
  }
  if (keywords.length > KEYWORD_LIMIT) {
    errors.push(
      `skill.config.json: keywords must list at most ${KEYWORD_LIMIT} terms; found ${keywords.length}.`,
    );
  }

  const seen = new Set();
  for (const keyword of keywords) {
    if (
      typeof keyword !== "string" ||
      keyword.length < 2 ||
      keyword.length > 40 ||
      !KEYWORD_PATTERN.test(keyword)
    ) {
      errors.push(
        `skill.config.json: keyword ${JSON.stringify(keyword)} must be 2-40 ` +
          "lowercase letters, numbers, or single hyphens or spaces.",
      );
      continue;
    }
    if (seen.has(keyword)) {
      errors.push(`skill.config.json: keyword "${keyword}" is listed twice.`);
    }
    seen.add(keyword);
  }
}

function validatePackageIdentity(root, config, errors) {
  if (config.template) return;

  for (const relativePath of ["package.json", "package-lock.json"]) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      errors.push(`${relativePath}: ${error.message}`);
      continue;
    }
    if (value.name === "skillsmithy-template") {
      errors.push(
        `${relativePath}: package name "skillsmithy-template" is reserved for ` +
          "the pristine template; use a project-specific name when template is false.",
      );
    }
    if (
      relativePath === "package-lock.json" &&
      value.packages?.[""]?.name === "skillsmithy-template"
    ) {
      errors.push(
        'package-lock.json: packages[""].name "skillsmithy-template" is reserved ' +
          "for the pristine template; regenerate or update the lockfile identity.",
      );
    }
  }
}

function validateToolingState(root, config, errors, warnings) {
  if (config.template) return;
  const packagePath = path.join(root, "package.json");
  const provenancePath = path.join(
    root,
    ".skillsmithy",
    "provenance.json",
  );
  if (!fs.existsSync(packagePath)) {
    return;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return;
  }

  if (!fs.existsSync(provenancePath)) {
    warnings.push(
      "Skill Smithy provenance is absent; install a current package and run `npm run migrate -- --dry-run` before applying the bootstrap migration.",
    );
    return;
  } else {
    try {
      const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
      const packageName = provenance.package;
      const declared =
        typeof packageName === "string"
          ? packageJson.devDependencies?.[packageName]
          : undefined;
      if (!declared) {
        errors.push(
          `${relative(root, provenancePath)}: recorded package must be present in package.json devDependencies.`,
        );
      } else if (
        // Only an exact pin can disagree. A range or a `file:` spec does not
        // name one release, so comparing it would warn about nothing.
        SEMVER_PATTERN.test(declared) &&
        typeof provenance.version === "string" &&
        declared !== provenance.version
      ) {
        warnings.push(
          `package.json pins ${packageName}@${declared} but ` +
            `${relative(root, provenancePath)} records ${provenance.version}; ` +
            "run `npm run migrate -- --dry-run` to bring managed files up to the installed release.",
        );
      }
    } catch (error) {
      errors.push(`${relative(root, provenancePath)}: ${error.message}`);
    }
  }

  for (const [name, expected] of Object.entries(DESTINATION_SCRIPTS)) {
    if (packageJson.scripts?.[name] !== expected) {
      errors.push(
        `package.json: scripts.${name} must be "${expected}".`,
      );
    }
  }

  if (!fs.existsSync(path.join(root, "package-lock.json"))) {
    warnings.push(
      "package-lock.json is absent; run `npm install` and commit the lockfile.",
    );
  }
}

function validateSkill(root, skill, config, errors, warnings) {
  const prefix = relative(root, skill.skillPath);
  const { frontmatter, body, directoryName } = skill;
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > 64) {
    errors.push(
      `${prefix}: name must be 1-64 lowercase letters, numbers, or single hyphens.`,
    );
  } else if (name !== directoryName) {
    errors.push(
      `${prefix}: frontmatter name "${name}" must match parent directory "${directoryName}".`,
    );
  }
  if (
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 1024
  ) {
    errors.push(`${prefix}: description must be a non-empty string up to 1024 characters.`);
  }
  if (
    frontmatter.compatibility != null &&
    (typeof frontmatter.compatibility !== "string" ||
      frontmatter.compatibility.length > 500)
  ) {
    errors.push(`${prefix}: compatibility must be a string up to 500 characters.`);
  }
  if (
    frontmatter["allowed-tools"] != null &&
    typeof frontmatter["allowed-tools"] !== "string"
  ) {
    errors.push(`${prefix}: allowed-tools must be a space-separated string.`);
  }
  if (frontmatter.metadata != null && !isMapping(frontmatter.metadata)) {
    errors.push(`${prefix}: metadata must be a YAML mapping.`);
  }
  if (config.targets.openclaw) {
    validateOpenClawMetadata(prefix, frontmatter, errors, warnings);
    auditClawHubSkill(root, skill, errors, warnings);
  }
  validateHermesMetadata(prefix, frontmatter, errors, warnings);
  if (!body.trim()) {
    errors.push(`${prefix}: the Markdown body must not be empty.`);
  }
  if (body.split(/\r?\n/).length > 500) {
    warnings.push(`${prefix}: body exceeds 500 lines; move detail into references/.`);
  }

  const openaiYaml = path.join(skill.directory, "agents", "openai.yaml");
  if (fs.existsSync(openaiYaml)) {
    validateOpenAiYaml(openaiYaml, name, errors);
  }
}

const OPENCLAW_METADATA_KEYS = ["openclaw", "clawdbot", "clawdis"];
const OPENCLAW_REQUIREMENT_ARRAYS = [
  "env",
  "bins",
  "anyBins",
  "config",
];
const CLAWHUB_BUNDLE_LIMIT_BYTES = 50 * 1024 * 1024;
const COMMON_SHELL_ENV_VARS = new Set([
  "CI",
  "HOME",
  "PATH",
  "PWD",
  "SHELL",
  "TEMP",
  "TMP",
  "USER",
]);

function validateOpenClawMetadata(prefix, frontmatter, errors, warnings) {
  if (!isMapping(frontmatter.metadata)) return;
  const present = OPENCLAW_METADATA_KEYS.filter(
    (key) => frontmatter.metadata[key] != null,
  );
  if (present.length > 1) {
    warnings.push(
      `${prefix}: metadata declares multiple OpenClaw aliases (${present.join(
        ", ",
      )}); keep one canonical metadata.openclaw mapping to avoid conflicting requirements.`,
    );
  }

  for (const key of present) {
    validateOpenClawRuntime(
      `${prefix}: metadata.${key}`,
      frontmatter.metadata[key],
      errors,
      warnings,
    );
  }
}

function validateOpenClawRuntime(prefix, runtime, errors, warnings) {
  if (!isMapping(runtime)) {
    errors.push(`${prefix} must be a YAML mapping.`);
    return;
  }

  const requires = runtime.requires;
  if (requires != null && !isMapping(requires)) {
    errors.push(`${prefix}.requires must be a YAML mapping.`);
  } else if (isMapping(requires)) {
    for (const field of OPENCLAW_REQUIREMENT_ARRAYS) {
      if (requires[field] != null && !isStringArray(requires[field])) {
        errors.push(
          `${prefix}.requires.${field} must be an array of non-empty strings.`,
        );
      }
    }
  }

  for (const field of ["primaryEnv", "skillKey", "emoji"]) {
    if (
      runtime[field] != null &&
      (typeof runtime[field] !== "string" || !runtime[field].trim())
    ) {
      errors.push(`${prefix}.${field} must be a non-empty string.`);
    }
  }
  if (runtime.homepage != null) {
    if (
      typeof runtime.homepage !== "string" ||
      !runtime.homepage.trim()
    ) {
      errors.push(`${prefix}.homepage must be a non-empty absolute URL.`);
    } else {
      try {
        new URL(runtime.homepage);
      } catch {
        errors.push(`${prefix}.homepage must be an absolute URL.`);
      }
    }
  }
  if (runtime.always != null && typeof runtime.always !== "boolean") {
    errors.push(`${prefix}.always must be a boolean.`);
  }
  if (runtime.os != null && !isStringArray(runtime.os)) {
    errors.push(`${prefix}.os must be an array of non-empty strings.`);
  }
  for (const field of ["nix", "config"]) {
    if (runtime[field] != null && !isMapping(runtime[field])) {
      errors.push(`${prefix}.${field} must be a YAML mapping.`);
    }
  }

  const declaredEnv = new Set(
    isStringArray(requires?.env) ? requires.env : [],
  );
  if (runtime.envVars != null) {
    if (!Array.isArray(runtime.envVars)) {
      errors.push(`${prefix}.envVars must be an array of mappings.`);
    } else {
      for (const [index, variable] of runtime.envVars.entries()) {
        const variablePrefix = `${prefix}.envVars[${index}]`;
        if (!isMapping(variable)) {
          errors.push(`${variablePrefix} must be a mapping.`);
          continue;
        }
        if (typeof variable.name !== "string" || !variable.name.trim()) {
          errors.push(`${variablePrefix}.name must be a non-empty string.`);
        } else {
          declaredEnv.add(variable.name);
        }
        if (
          variable.required != null &&
          typeof variable.required !== "boolean"
        ) {
          errors.push(`${variablePrefix}.required must be a boolean.`);
        }
        if (
          variable.description != null &&
          (typeof variable.description !== "string" ||
            !variable.description.trim())
        ) {
          errors.push(
            `${variablePrefix}.description must be a non-empty string.`,
          );
        }
      }
    }
  }

  if (
    typeof runtime.primaryEnv === "string" &&
    runtime.primaryEnv.trim() &&
    !declaredEnv.has(runtime.primaryEnv)
  ) {
    warnings.push(
      `${prefix}.primaryEnv "${runtime.primaryEnv}" is not declared in ` +
        "requires.env or envVars; ClawHub security analysis may report a metadata mismatch.",
    );
  }

  if (runtime.install != null) {
    if (!Array.isArray(runtime.install)) {
      errors.push(`${prefix}.install must be an array of mappings.`);
    } else {
      for (const [index, spec] of runtime.install.entries()) {
        const installPrefix = `${prefix}.install[${index}]`;
        if (!isMapping(spec)) {
          errors.push(`${installPrefix} must be a mapping.`);
          continue;
        }
        if (!["brew", "node", "go", "uv"].includes(spec.kind)) {
          errors.push(
            `${installPrefix}.kind must be brew, node, go, or uv.`,
          );
        }
        if (spec.bins != null && !isStringArray(spec.bins)) {
          errors.push(
            `${installPrefix}.bins must be an array of non-empty strings.`,
          );
        }
      }
    }
  }
}

function auditClawHubSkill(root, skill, errors, warnings) {
  const prefix = relative(root, skill.skillPath);
  if (skill.frontmatter.license != null) {
    errors.push(
      `${prefix}: ClawHub fixes skill licensing to MIT-0 and does not support ` +
        "a frontmatter license override; remove the license field.",
    );
  }
  for (const field of ["paid", "price", "pricing"]) {
    if (skill.frontmatter[field] != null) {
      errors.push(
        `${prefix}: ClawHub does not support paid-skill metadata; remove frontmatter field "${field}".`,
      );
    }
  }

  const skillLicenseEntry = fs
    .readdirSync(skill.directory, { withFileTypes: true })
    .find(
      (entry) =>
        entry.isFile() &&
        /^licen[cs]e(\.[a-z0-9]+)?$/i.test(entry.name),
    );
  const skillLicense = skillLicenseEntry
    ? path.join(skill.directory, skillLicenseEntry.name)
    : null;
  if (skillLicense) {
    const sample = fs.readFileSync(skillLicense).subarray(0, 16 * 1024);
    const text = sample.toString("utf8").toLowerCase();
    if (!text.includes("mit no attribution") && !text.includes("mit-0")) {
      warnings.push(
        `${relative(root, skillLicense)} does not appear to grant MIT-0. ` +
          "ClawHub publishes every skill under MIT-0, so confirm that this " +
          "skill-local licence is not conflicting before publishing.",
      );
    }
  }

  const bundle = inspectClawHubBundle(skill.directory);
  if (bundle.bytes > CLAWHUB_BUNDLE_LIMIT_BYTES) {
    warnings.push(
      `${prefix}: regular non-hidden files total ${formatBytes(bundle.bytes)}, ` +
        "above ClawHub's 50 MB bundle limit before .gitignore or .clawhubignore " +
        "evaluation. Exclude files or confirm the exact CLI dry-run bundle.",
    );
  }
  for (const link of bundle.symlinks.slice(0, 5)) {
    warnings.push(
      `${relative(root, link)} is a symbolic link; ClawHub omits symlinks from published skills.`,
    );
  }
  for (const hidden of bundle.hidden.slice(0, 5)) {
    if ([".clawhubignore", ".gitignore"].includes(path.basename(hidden))) {
      continue;
    }
    warnings.push(
      `${relative(root, hidden)} is hidden; ClawHub omits hidden paths from published skills.`,
    );
  }

  const declaredEnv = collectDeclaredOpenClawEnv(skill.frontmatter);
  for (const reference of findEnvironmentReferences(skill.directory)) {
    if (declaredEnv.has(reference.name)) continue;
    warnings.push(
      `${relative(root, reference.file)} references environment variable ` +
        `${reference.name}, but metadata.openclaw does not declare it in ` +
        "requires.env, primaryEnv, or envVars.",
    );
  }

}

function inspectClawHubBundle(directory) {
  const result = { bytes: 0, hidden: [], symlinks: [] };
  const visit = (current, hiddenParent = false) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const hidden = hiddenParent || entry.name.startsWith(".");
      if (entry.isSymbolicLink()) {
        result.symlinks.push(absolute);
      } else if (entry.isDirectory()) {
        if (hidden) result.hidden.push(absolute);
        visit(absolute, hidden);
      } else if (entry.isFile()) {
        if (hidden) {
          result.hidden.push(absolute);
        } else {
          result.bytes += fs.statSync(absolute).size;
        }
      }
    }
  };
  visit(directory);
  return result;
}

function collectDeclaredOpenClawEnv(frontmatter) {
  const declared = new Set();
  if (!isMapping(frontmatter.metadata)) return declared;
  for (const key of OPENCLAW_METADATA_KEYS) {
    const runtime = frontmatter.metadata[key];
    if (!isMapping(runtime)) continue;
    if (isStringArray(runtime.requires?.env)) {
      for (const name of runtime.requires.env) declared.add(name);
    }
    if (typeof runtime.primaryEnv === "string") {
      declared.add(runtime.primaryEnv);
    }
    if (Array.isArray(runtime.envVars)) {
      for (const variable of runtime.envVars) {
        if (typeof variable?.name === "string") declared.add(variable.name);
      }
    }
  }
  return declared;
}

function findEnvironmentReferences(directory) {
  const found = new Map();
  const patterns = [
    /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g,
    /os\.(?:getenv|environ\.get)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /std::env::var\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\$env:([A-Z][A-Z0-9_]*)/gi,
  ];

  for (const file of listRegularFiles(directory)) {
    const buffer = fs.readFileSync(file);
    if (!isUtf8TextFile(file, buffer) || buffer.length > 2 * 1024 * 1024) {
      continue;
    }
    const text = buffer.toString("utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const name = match.slice(1).find(Boolean)?.toUpperCase();
        if (!name || COMMON_SHELL_ENV_VARS.has(name)) continue;
        found.set(`${file}\0${name}`, { file, name });
      }
    }
  }
  return [...found.values()].slice(0, 20);
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The documented metadata.hermes fields that take an array of strings.
// Unrecognized keys are left alone so vendor metadata passes through
// unchanged; only these are shape-checked. Note that Hermes has no
// "category" field: skills are categorized with tags.
const HERMES_STRING_ARRAY_FIELDS = [
  "tags",
  "related_skills",
  "requires_toolsets",
  "requires_tools",
  "fallback_for_toolsets",
  "fallback_for_tools",
];

function validateHermesMetadata(prefix, frontmatter, errors, warnings) {
  if (frontmatter.platforms != null) {
    if (
      !isStringArray(frontmatter.platforms) ||
      frontmatter.platforms.length === 0 ||
      frontmatter.platforms.some(
        (platform) => !["macos", "linux", "windows"].includes(platform),
      )
    ) {
      errors.push(
        `${prefix}: platforms must be a non-empty array containing only macos, linux, or windows.`,
      );
    }
  }

  const hermes = frontmatter.metadata?.hermes;
  if (hermes == null) return;
  if (!isMapping(hermes)) {
    errors.push(`${prefix}: metadata.hermes must be a YAML mapping.`);
    return;
  }

  for (const field of HERMES_STRING_ARRAY_FIELDS) {
    if (hermes[field] != null && !isStringArray(hermes[field])) {
      errors.push(
        `${prefix}: metadata.hermes.${field} must be an array of non-empty strings.`,
      );
    }
  }

  if (hermes.category != null) {
    warnings.push(
      `${prefix}: metadata.hermes.category is not a recognized Hermes field; ` +
        "categorize the skill with metadata.hermes.tags instead.",
    );
  }

  if (hermes.blueprint != null && !isMapping(hermes.blueprint)) {
    errors.push(`${prefix}: metadata.hermes.blueprint must be a YAML mapping.`);
  }

  if (hermes.config != null) {
    if (!Array.isArray(hermes.config)) {
      errors.push(`${prefix}: metadata.hermes.config must be an array of mappings.`);
    } else {
      for (const [index, setting] of hermes.config.entries()) {
        const settingPrefix = `${prefix}: metadata.hermes.config[${index}]`;
        if (!isMapping(setting)) {
          errors.push(`${settingPrefix} must be a mapping.`);
          continue;
        }
        // key and description are both required; default and prompt are
        // optional, and `default` may be any scalar the setting accepts.
        for (const key of ["key", "description"]) {
          if (typeof setting[key] !== "string" || !setting[key].trim()) {
            errors.push(`${settingPrefix}.${key} must be a non-empty string.`);
          }
        }
        if (
          setting.prompt != null &&
          (typeof setting.prompt !== "string" || !setting.prompt.trim())
        ) {
          errors.push(`${settingPrefix}.prompt must be a non-empty string.`);
        }
      }
    }
  }
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim())
  );
}

function isMapping(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function validateOpenAiYaml(filePath, skillName, errors) {
  const document = parseDocument(fs.readFileSync(filePath, "utf8"), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    errors.push(
      `${filePath}: ${document.errors.map((error) => error.message).join("; ")}`,
    );
    return;
  }
  const value = document.toJS({ mapAsMap: false });
  const ui = value?.interface;
  if (!ui || typeof ui !== "object") {
    errors.push(`${filePath}: interface mapping is required.`);
    return;
  }
  if (typeof ui.display_name !== "string" || !ui.display_name.trim()) {
    errors.push(`${filePath}: interface.display_name is required.`);
  }
  if (
    typeof ui.short_description !== "string" ||
    ui.short_description.length < 25 ||
    ui.short_description.length > 64
  ) {
    errors.push(`${filePath}: interface.short_description must be 25-64 characters.`);
  }
  if (
    typeof ui.default_prompt !== "string" ||
    !ui.default_prompt.includes(`$${skillName}`)
  ) {
    errors.push(
      `${filePath}: interface.default_prompt must explicitly mention $${skillName}.`,
    );
  }
}

export function validateGenerated(root, config) {
  const errors = [];
  const repoUrl = `https://github.com/${config.repo}`;

  if (config.targets.claude) {
    const marketplace = readJson(
      root,
      ".claude-plugin/marketplace.json",
      errors,
    );
    const manifest = readJson(root, ".claude-plugin/plugin.json", errors);
    if (marketplace) {
      requireKeys(marketplace, ["name", "owner", "description", "plugins"], errors, "Claude marketplace");
      if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
        errors.push("Claude marketplace must contain exactly one plugin entry.");
      } else if (marketplace.plugins[0].source !== "./") {
        errors.push('Claude marketplace plugin source must be "./".');
      }
    }
    if (manifest) {
      requireKeys(manifest, ["name", "description", "version"], errors, "Claude plugin");
      if (manifest.name !== config.pluginName) {
        errors.push("Claude plugin name does not match pluginName.");
      }
    }
  }

  if (config.targets.codex) {
    const marketplace = readJson(root, ".agents/plugins/marketplace.json", errors);
    const manifest = readJson(root, ".codex-plugin/plugin.json", errors);
    if (marketplace) {
      requireKeys(marketplace, ["name", "interface", "plugins"], errors, "Codex marketplace");
      const entry = marketplace.plugins?.[0];
      if (!entry || marketplace.plugins.length !== 1) {
        errors.push("Codex marketplace must contain exactly one plugin entry.");
      } else {
        requireKeys(entry, ["name", "source", "policy", "category"], errors, "Codex marketplace plugin");
        if (entry.source?.source !== "local" || entry.source?.path !== "./") {
          errors.push('Codex marketplace source must be { source: "local", path: "./" }.');
        }
      }
    }
    if (manifest) {
      requireKeys(
        manifest,
        ["name", "version", "description", "skills", "interface"],
        errors,
        "Codex plugin",
      );
      if (manifest.skills !== "./skills/") {
        errors.push('Codex plugin skills must point to "./skills/".');
      }
      if (manifest.repository !== repoUrl) {
        errors.push("Codex plugin repository does not match config.repo.");
      }
    }
  }

  if (
    !config.template &&
    config.targets.openclaw &&
    ["manual", "push"].includes(config.clawhub?.githubActions)
  ) {
    const relativePath = ".github/workflows/clawhub-publish.yml";
    const workflow = readYaml(root, relativePath, errors);
    const expectedUse =
      "openclaw/clawhub/.github/workflows/skill-publish.yml@main";
    if (workflow) {
      if (workflow.jobs?.["dry-run"]?.uses !== expectedUse) {
        errors.push(
          `${relativePath}: dry-run job must use ClawHub's reusable skill workflow from main.`,
        );
      }
      if (workflow.jobs?.publish?.uses !== expectedUse) {
        errors.push(
          `${relativePath}: publish job must use ClawHub's reusable skill workflow from main.`,
        );
      }
      for (const jobName of ["dry-run", "publish"]) {
        if (workflow.jobs?.[jobName]?.with?.root !== config.sourceDir) {
          errors.push(
            `${relativePath}: ${jobName} root must match config.sourceDir.`,
          );
        }
      }
      if (
        config.clawhub.owner &&
        workflow.jobs?.publish?.with?.owner !== config.clawhub.owner
      ) {
        errors.push(
          `${relativePath}: publish owner must match config.clawhub.owner.`,
        );
      }
      if (workflow.jobs?.publish?.secrets?.clawhub_token == null) {
        errors.push(
          `${relativePath}: publish job must receive the CLAWHUB_TOKEN secret.`,
        );
      }
      if (
        config.clawhub.githubActions === "push" &&
        workflow.on?.push?.branches?.[0] !==
          (config.clawhub.publishBranch || "main")
      ) {
        errors.push(
          `${relativePath}: push branch must match config.clawhub.publishBranch.`,
        );
      }
    }
  }

  return errors;
}

function readYaml(root, rel, errors) {
  const filePath = path.join(root, rel);
  try {
    const document = parseDocument(fs.readFileSync(filePath, "utf8"), {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length) {
      throw new Error(
        document.errors.map((error) => error.message).join("; "),
      );
    }
    return document.toJS({ mapAsMap: false });
  } catch (error) {
    errors.push(`${rel}: ${error.message}`);
    return null;
  }
}

function readJson(root, rel, errors) {
  const filePath = path.join(root, rel);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${rel}: ${error.message}`);
    return null;
  }
}

function requireKeys(value, keys, errors, label) {
  for (const key of keys) {
    if (value?.[key] == null) errors.push(`${label} is missing "${key}".`);
  }
}

// The optional `exclude` predicate receives each entry's path relative to
// `source`, always forward-slashed, and skips the entry when it returns true.
// Callers pass it only for generated discovery copies; import and mint copy
// whole trees byte for byte and leave it unset.
export function copyTree(source, destination, exclude) {
  copyEntry(source, destination, "", exclude);
}

// Returns whether anything was written, so a parent can tell an emptied
// directory from a copied one.
function copyEntry(source, destination, relativePath, exclude) {
  if (relativePath && exclude?.(relativePath)) return false;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const target = fs.readlinkSync(source);
    const type =
      process.platform === "win32" && fs.statSync(source).isDirectory()
        ? "junction"
        : undefined;
    fs.symlinkSync(target, destination, type);
    return true;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: stat.mode });
    const entries = fs.readdirSync(source);
    let written = 0;
    for (const entry of entries) {
      const child = relativePath ? `${relativePath}/${entry}` : entry;
      if (
        copyEntry(path.join(source, entry), path.join(destination, entry), child, exclude)
      ) {
        written += 1;
      }
    }
    // A directory left empty only by an exclusion must not ship: git cannot
    // track an empty directory, so committing one would make drift checking
    // fail for anyone who cloned the repository. A source directory that was
    // already empty is copied as before.
    if (entries.length > 0 && written === 0) {
      fs.rmdirSync(destination);
      return false;
    }
    if (process.platform !== "win32") fs.chmodSync(destination, stat.mode);
    return true;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (process.platform !== "win32") fs.chmodSync(destination, stat.mode);
  return true;
}

export function replaceGenerated(destinationRoot, stageRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  assertGeneratedPathsWritable(destinationRoot);
  const transaction = fs.mkdtempSync(
    path.join(destinationRoot, ".skillsmithy-transaction-"),
  );
  const backupRoot = path.join(transaction, "backup");
  const installed = [];
  const backedUp = [];
  let removeTransaction = false;

  try {
    for (const rel of GENERATED_PATHS) {
      const current = path.join(destinationRoot, rel);
      if (!fs.existsSync(current)) continue;
      const backup = path.join(backupRoot, rel);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      renameGeneratedPath(current, backup, rel, "back up");
      backedUp.push(rel);
    }

    for (const rel of GENERATED_PATHS) {
      const staged = path.join(stageRoot, rel);
      if (!fs.existsSync(staged)) continue;
      const destination = path.join(destinationRoot, rel);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      renameGeneratedPath(staged, destination, rel, "install");
      installed.push(rel);
    }
    removeTransaction = true;
  } catch (error) {
    const rollbackErrors = [];
    try {
      for (const rel of installed.reverse()) {
        fs.rmSync(path.join(destinationRoot, rel), {
          recursive: true,
          force: true,
        });
      }
      for (const rel of backedUp.reverse()) {
        const backup = path.join(backupRoot, rel);
        const destination = path.join(destinationRoot, rel);
        if (!fs.existsSync(backup)) continue;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        renameGeneratedPath(backup, destination, rel, "restore");
      }
      removeTransaction = true;
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Generated output replacement failed and rollback was incomplete. ` +
          `Recovery data remains at ${transaction}`,
      );
    }
    throw error;
  } finally {
    if (removeTransaction) {
      fs.rmSync(transaction, { recursive: true, force: true });
    }
  }
}

export function assertGeneratedPathsWritable(
  destinationRoot,
  access = fs.accessSync,
) {
  const failures = [];
  for (const rel of GENERATED_PATHS) {
    const target = path.join(destinationRoot, rel);
    const candidates = [];
    if (fs.existsSync(target)) candidates.push(target);

    let parent = path.dirname(target);
    while (!fs.existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    candidates.push(parent);

    for (const candidate of new Set(candidates)) {
      try {
        access(candidate, fs.constants.W_OK);
      } catch (error) {
        failures.push({
          rel,
          candidate,
          code: error?.code ?? "permission error",
        });
        break;
      }
    }
  }

  if (failures.length) {
    const details = failures
      .map(
        ({ rel, candidate, code }) =>
          `"${rel}" (${code} at ${candidate})`,
      )
      .join(", ");
    throw new Error(
      `Generated output is not writable: ${details}. Request write permission ` +
        "or temporarily unload the active generated skill, then retry. To validate " +
        "a staged build without replacing in-place discovery paths, run " +
        "`npm run build -- --out-dir <empty-directory>`.",
    );
  }
}

function renameGeneratedPath(source, destination, rel, action) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    throw new Error(
      `Cannot ${action} generated path "${rel}" (${error.code ?? "rename failed"}). ` +
        "Request write permission or temporarily unload the active generated skill, " +
        "then retry. To validate a staged build without replacing in-place discovery " +
        "paths, run `npm run build -- --out-dir <empty-directory>`.",
      { cause: error },
    );
  }
}

export function compareGenerated(expectedRoot, actualRoot) {
  // A project may gitignore its discovery copies so that a marketplace
  // importer scanning the repository finds one SKILL.md instead of three.
  // Those paths are then absent from a fresh clone while a build still
  // produces them, and comparing the two would report every file as drift on
  // the first CI run. Git is the authority on what the repository carries, so
  // ignores are read from the working tree and skipped on both sides.
  const skipped = ignoredGeneratedPaths(expectedRoot);
  const expected = snapshotGenerated(expectedRoot, skipped);
  const actual = snapshotGenerated(actualRoot, skipped);
  const differences = [];
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of [...keys].sort()) {
    const left = expected.get(key);
    const right = actual.get(key);
    if (!left || !right || !sameEntry(left, right)) differences.push(key);
  }
  return differences;
}

// Exported so `check` can state which paths its comparison left out. A skipped
// path is a narrowed check, and a success message that does not say so reads as
// a guarantee the run never made.
export function ignoredGeneratedPaths(root, paths = GENERATED_PATHS) {
  const ignored = new Set();
  for (const relativePath of paths) {
    if (isGitIgnored(root, relativePath)) ignored.add(relativePath);
  }
  return ignored;
}

export function listTrackedDiscoveryFiles(root, run = spawnSync) {
  const topLevel = run("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  if (topLevel.error || topLevel.status !== 0) return [];

  const repositoryRoot = topLevel.stdout.trim();
  if (!samePath(repositoryRoot, root)) {
    // A destination nested in some unrelated repository must not inspect or
    // prescribe changes to that repository's index. Minted projects are
    // independent, so only their own Git root is authoritative.
    return [];
  }

  const tracked = run(
    "git",
    ["ls-files", "--", ".claude/skills", ".agents/skills"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (tracked.error || tracked.status !== 0) return [];
  return tracked.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function samePath(left, right) {
  const resolveExisting = (value) => {
    const absolute = path.resolve(value);
    try {
      return fs.realpathSync.native(absolute);
    } catch {
      return absolute;
    }
  };
  const normalizedLeft = path.normalize(resolveExisting(left));
  const normalizedRight = path.normalize(resolveExisting(right));
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function isGitIgnored(root, relativePath) {
  const posix = relativePath.split(path.sep).join("/");
  // A trailing-slash rule such as `.claude/skills/` matches a query without a
  // trailing slash only when the directory exists on disk. A fresh clone has
  // neither the directory nor the slash, which is the case that matters most,
  // so both spellings are asked.
  for (const candidate of [posix, `${posix}/`]) {
    const result = spawnSync("git", ["check-ignore", "-q", candidate], {
      cwd: root,
      stdio: "ignore",
    });
    // Exit 0 is ignored and 1 is not. Any other status, or no git at all,
    // means the question cannot be answered; comparing is the safe answer,
    // because a false "ignored" would silently stop reporting real drift.
    if (result.error) return false;
    if (result.status === 0) return true;
  }
  return false;
}

function snapshotGenerated(root, skipped = new Set()) {
  const entries = new Map();
  const visit = (absolute, relativePath) => {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.set(relativePath, {
        type: "link",
        target: fs.readlinkSync(absolute),
      });
      return;
    }
    if (stat.isDirectory()) {
      entries.set(`${relativePath}/`, {
        type: "directory",
        mode: process.platform === "win32" ? 0 : stat.mode & 0o777,
      });
      for (const name of fs.readdirSync(absolute)) {
        visit(path.join(absolute, name), path.join(relativePath, name));
      }
      return;
    }
    entries.set(relativePath, {
      type: "file",
      mode: process.platform === "win32" ? 0 : stat.mode & 0o777,
      contents: fs.readFileSync(absolute),
    });
  };

  for (const rel of GENERATED_PATHS) {
    if (skipped.has(rel)) continue;
    const absolute = path.join(root, rel);
    if (fs.existsSync(absolute)) visit(absolute, rel);
  }
  return entries;
}

function sameEntry(left, right) {
  if (left.type !== right.type || left.mode !== right.mode) return false;
  if (left.type === "link") return left.target === right.target;
  if (left.type === "file") return left.contents.equals(right.contents);
  return true;
}

export function resolveInside(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  const relativePath = path.relative(resolvedRoot, resolved);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("path must stay inside the repository.");
  }
  return resolved;
}

export function relative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

export function listRegularFiles(root) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  walk(root);
  return files;
}

function isUtf8TextFile(filePath, buffer) {
  const binaryExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".woff",
    ".woff2",
    ".ttf",
  ]);
  if (binaryExtensions.has(path.extname(filePath).toLowerCase())) return false;
  return !buffer.includes(0);
}
