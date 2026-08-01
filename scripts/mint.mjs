import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateProject } from "./generate.mjs";
import { describeProjectDocs, importSkill } from "./import-skill.mjs";
import { initializeProject } from "./init-project.mjs";
import {
  writeDestinationPackage,
  writeDestinationProvenance,
} from "./migrate.mjs";
import {
  GENERATED_PATHS,
  NAME_PATTERN,
  ROOT,
  copyTree,
  listSkillNames,
  loadConfig,
  readProject,
  writeDestinationIgnore,
  writeJson,
} from "./lib.mjs";

// Destinations receive an explicit allow list, never an exclusion list. Local
// agent settings, credentials, editor state, and future untracked files must
// not reach a published skill repository merely because nobody denied them.
const COPIED_ROOT_ENTRIES = [
  "CLAUDE.md",
  "skill.config.json",
  "skill.config.schema.json",
  "skills",
];

// This checkout's own `.gitignore` describes this checkout. A destination gets
// `templates/.gitignore.destination` instead, which survives packaging and
// states one ignore set for every project: `node_modules/`, local agent
// settings, interrupted staging directories, and the generated discovery
// copies. Committing those copies would put a second and third SKILL.md in the
// published repository, where a marketplace importer that scans for skills
// finds three where the project has one. Drift checking reads the same
// ignores, so a fresh clone still passes `npm run check`. The plugin and
// marketplace manifests under `.claude-plugin/`, `.codex-plugin/`, and
// `.agents/plugins/` are what installers read and stay committed.

// A destination is not a Skill Smithy checkout, so it must not receive Skill
// Forge's own `AGENTS.md`: half of that file describes the interview, `mint`,
// and `import`, none of which a destination can run. It receives the
// destination contract instead, installed under the name agents actually read.
// `CLAUDE.md` is copied verbatim because its `@AGENTS.md` import is already
// correct on both sides.
const DESTINATION_AGENTS_SOURCE = path.join("templates", "AGENTS.destination.md");
const DESTINATION_AGENTS_TARGET = "AGENTS.md";

// Publisher identity is never inherited. This checkout may be a fork whose
// skill.config.json already names its author, handle, and licence, and a
// destination is a different product with a different owner. Resetting these
// fields means a destination can only ever carry publisher metadata its own
// author supplied deliberately.
const PLACEHOLDER_OWNER = {
  name: "Your Name",
  url: "https://github.com/your-handle",
};
const PLACEHOLDER_REPO = "your-handle/your-repo";

// No LICENSE file is copied, so this field states the licence a destination is
// expected to confirm rather than describing a file that already exists. MIT-0
// is MIT without the attribution clause: it satisfies ClawHub, which publishes
// skills under MIT-0, and imposes no condition the other channels object to.
const DEFAULT_DESTINATION_LICENSE = "MIT-0";

export const PUBLISHER_RESET_NOTE =
  `Publisher metadata reset to placeholders and license set to ` +
  `${DEFAULT_DESTINATION_LICENSE}; ClawHub Actions disabled and no LICENSE ` +
  `file copied. Set publishing details from your own answers before publishing.`;

export function mintProject(sourceRoot, name, destinationInput) {
  assertName(name);
  const context = inspectMintContext(sourceRoot, destinationInput);
  installPreparedProject(context, (stage) => {
    initializeProject(stage, { name });
  });

  return {
    name,
    source: context.source,
    destination: context.destination,
    canonicalSkill: path.join(
      context.destination,
      context.config.sourceDir,
      name,
    ),
  };
}

export function mintImportedProject(
  sourceRoot,
  input,
  destinationInput,
  { dryRun = false } = {},
) {
  if (!input) {
    throw new Error("An existing SKILL.md file or skill directory is required.");
  }
  const context = inspectMintContext(sourceRoot, destinationInput);
  // The destination is minted fresh, so the template's own root documents
  // never count as collisions when the preview plans document placement.
  const preview = importSkill(context.source, input, {
    dryRun: true,
    freshProject: true,
  });
  assertImportDoesNotOverlapDestination(
    preview.source,
    context.destination,
  );
  const result = {
    name: preview.name,
    source: preview.source,
    templateSource: context.source,
    destination: context.destination,
    canonicalSkill: path.join(
      context.destination,
      context.config.sourceDir,
      preview.name,
    ),
    sourceDirName: context.config.sourceDir,
    projectDocs: preview.projectDocs,
    dryRun,
  };

  if (dryRun) {
    return {
      ...result,
      imported: false,
      errors: [],
      warnings: [],
    };
  }

  const imported = installPreparedProject(context, (stage) => {
    return importSkill(stage, input, { freshProject: true });
  });
  return {
    ...result,
    imported: true,
    projectDocs: imported.projectDocs,
    errors: imported.errors,
    warnings: imported.warnings,
  };
}

function inspectMintContext(sourceRoot, destinationInput) {
  if (!destinationInput) throw new Error("--out-dir requires a path.");

  const source = fs.realpathSync(path.resolve(sourceRoot));
  const destination = path.resolve(destinationInput);
  const comparableDestination = resolveForComparison(destination);

  if (
    isInside(source, comparableDestination) ||
    isInside(comparableDestination, source)
  ) {
    throw new Error(
      "Project destination must not be the Skill Smithy checkout, contain it, or be inside it.",
    );
  }

  const config = loadConfig(source);
  assertPristineTemplate(source, config);
  return {
    source,
    destination,
    destinationState: inspectDestination(destination),
    config,
  };
}

function assertPristineTemplate(source, config) {
  const skills = listSkillNames(source, config.sourceDir);
  if (
    !config.template ||
    skills.length !== 1 ||
    skills[0] !== "example-skill"
  ) {
    throw new Error(
      "Project creation must run from a pristine Skill Smithy template containing only skills/example-skill.",
    );
  }
}

function assertImportDoesNotOverlapDestination(sourceInput, destination) {
  const source = fs.realpathSync(path.resolve(sourceInput));
  const comparableDestination = resolveForComparison(destination);
  if (
    isInside(source, comparableDestination) ||
    isInside(comparableDestination, source)
  ) {
    throw new Error(
      "Import destination must not contain, replace, or be inside the supplied skill source.",
    );
  }
}

function installPreparedProject(context, configureStage) {
  const { source, destination, destinationState } = context;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stage = fs.mkdtempSync(
    path.join(path.dirname(destination), ".skillsmithy-mint-"),
  );
  let removedEmptyDestination = false;
  let installed = false;

  try {
    copyTemplate(source, stage);
    // Reset before the stage is configured, so both the mint and import paths
    // load the placeholder identity rather than this checkout's.
    resetInheritedMetadata(stage);
    const operationResult = configureStage(stage);
    writeDestinationPackage(stage, source);
    refreshGeneratedScaffold(stage);
    writeDestinationProvenance(stage, source);

    if (destinationState === "empty-directory") {
      fs.rmdirSync(destination);
      removedEmptyDestination = true;
    }
    fs.renameSync(stage, destination);
    installed = true;
    return operationResult;
  } catch (error) {
    if (removedEmptyDestination && !fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    throw error;
  } finally {
    if (!installed && fs.existsSync(stage)) {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

function copyTemplate(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of COPIED_ROOT_ENTRIES) {
    const from = path.join(source, entry);
    if (!fs.existsSync(from)) continue;
    copyTree(from, path.join(destination, entry));
  }

  // Missing optional entries above are skipped, but a destination without an
  // authoring contract is not a destination worth creating, so this one fails
  // loudly rather than shipping a project with no instructions.
  const agentsSource = path.join(source, DESTINATION_AGENTS_SOURCE);
  if (!fs.existsSync(agentsSource)) {
    throw new Error(
      `Template is missing ${DESTINATION_AGENTS_SOURCE}, the authoring ` +
        `contract installed as a destination's ${DESTINATION_AGENTS_TARGET}.`,
    );
  }
  copyTree(agentsSource, path.join(destination, DESTINATION_AGENTS_TARGET));

  // A destination with no ignore file would commit its own node_modules, so
  // this one fails loudly too.
  writeDestinationIgnore(destination, source);

  // No README or LICENSE is written. The destination is a distinct product,
  // and its product page, licence, and CI are for its author to create.
}

function resetInheritedMetadata(root) {
  const config = loadConfig(root);
  // Any owner.email is dropped rather than replaced: an address is publisher
  // identity, and the schema makes the field optional precisely so a project
  // publishes one only on purpose.
  config.license = DEFAULT_DESTINATION_LICENSE;
  config.owner = { ...PLACEHOLDER_OWNER };
  config.repo = PLACEHOLDER_REPO;
  // ClawHub publishing authority is separate from repository ownership.
  // Destinations start with automation disabled and no inherited publisher
  // handle, even when a customized Skill Smithy checkout uses one itself.
  config.clawhub = {
    githubActions: "off",
    publishBranch: "main",
  };
  // Keywords describe one product's discovery terms. A fork that set them for
  // its own skill must not have them silently ship in manifests describing an
  // unrelated one, and an absent field is the documented default.
  delete config.keywords;
  writeJson(path.join(root, "skill.config.json"), config);
}

function refreshGeneratedScaffold(root) {
  for (const relativePath of GENERATED_PATHS) {
    fs.rmSync(path.join(root, relativePath), {
      recursive: true,
      force: true,
    });
  }
  generateProject(readProject(root), root);
}

function inspectDestination(destination) {
  if (!fs.existsSync(destination)) return "missing";
  const stat = fs.lstatSync(destination);
  if (stat.isSymbolicLink()) {
    throw new Error("Project destination must not be a symbolic link.");
  }
  if (!stat.isDirectory()) {
    throw new Error("Project destination already exists and is not a directory.");
  }
  if (fs.readdirSync(destination).length) {
    throw new Error("Project destination already exists and is not empty.");
  }
  return "empty-directory";
}

function resolveForComparison(candidate) {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  const remainder = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    remainder.unshift(path.basename(existing));
    existing = parent;
  }
  const resolvedExisting = fs.existsSync(existing)
    ? fs.realpathSync(existing)
    : existing;
  return path.resolve(resolvedExisting, ...remainder);
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

function assertName(value) {
  if (
    typeof value !== "string" ||
    !NAME_PATTERN.test(value) ||
    value.length > 64
  ) {
    throw new Error(
      "skill name must be 1-64 lowercase letters, numbers, or single hyphens.",
    );
  }
}

export function parseMintArguments(args) {
  const parsed = { name: null, from: null, outDir: null, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      parsed.from = args[index + 1];
      if (!parsed.from) throw new Error("--from requires a path.");
      index += 1;
    } else if (arg === "--out-dir") {
      parsed.outDir = args[index + 1];
      if (!parsed.outDir) throw new Error("--out-dir requires a path.");
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.name) {
      parsed.name = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (parsed.name && parsed.from) {
    throw new Error("Provide a skill name or --from source, not both.");
  }
  if (parsed.dryRun && !parsed.from) {
    throw new Error("--dry-run is available only with --from.");
  }
  return parsed;
}

function usage() {
  console.error("Usage:");
  console.error("  npm run mint -- <skill-name> --out-dir <destination>");
  console.error(
    "  npm run mint -- --from <path-to-SKILL.md-or-directory> --out-dir <destination>",
  );
  console.error(
    "  npm run mint -- --from <path> --out-dir <destination> --dry-run",
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseMintArguments(process.argv.slice(2));
    if ((!options.name && !options.from) || !options.outDir) {
      usage();
      process.exitCode = 1;
    } else {
      const result = options.from
        ? mintImportedProject(ROOT, options.from, options.outDir, {
            dryRun: options.dryRun,
          })
        : mintProject(ROOT, options.name, options.outDir);
      if (result.dryRun) {
        console.log("Dry run: no files were written.");
        console.log(`Would import ${result.source}`);
        console.log(`Would create project: ${result.destination}`);
      } else {
        console.log(
          `${options.from ? "Imported" : "Minted"} "${result.name}" at ${result.destination}`,
        );
      }
      console.log(`Canonical skill: ${result.canonicalSkill}`);
      for (const note of describeProjectDocs(result)) console.log(note);
      if (!result.dryRun) {
        console.log(PUBLISHER_RESET_NOTE);
        console.log(
          "Next: open the destination with your agent, run `npm install`, and follow AGENTS.md.",
        );
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
