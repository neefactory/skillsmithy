import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeProjectDocs } from "./import-skill.mjs";
import { ROOT } from "./lib.mjs";
import { PUBLISHER_RESET_NOTE, mintImportedProject } from "./mint.mjs";

export function parseImportArguments(args) {
  const parsed = { input: null, outDir: null, dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out-dir") {
      parsed.outDir = args[index + 1];
      if (!parsed.outDir) throw new Error("--out-dir requires a path.");
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function printResult(result) {
  if (result.dryRun) {
    console.log("Dry run: no files were written.");
    console.log(`Would import ${result.source}`);
    console.log(`Would create project: ${result.destination}`);
    console.log(`Canonical skill: ${result.canonicalSkill}`);
    for (const note of describeProjectDocs(result)) console.log(note);
    return;
  }

  console.log(`Imported "${result.name}" into ${result.destination}`);
  console.log(`Canonical skill: ${result.canonicalSkill}`);
  console.log("The supplied skill and Skill Smithy checkout were not edited.");
  for (const note of describeProjectDocs(result)) console.log(note);
  console.log(PUBLISHER_RESET_NOTE);
  for (const warning of result.warnings) {
    console.warn(`Validation warning: ${warning}`);
  }
  for (const error of result.errors) {
    console.warn(`Validation finding: ${error}`);
  }
  console.log(
    "Next: open the destination with your agent, run `npm install`, review repository metadata, and follow AGENTS.md.",
  );
}

function usage() {
  console.error("Usage:");
  console.error(
    "  npm run import -- <path-to-SKILL.md-or-directory> --out-dir <destination>",
  );
  console.error(
    "  npm run import -- <path> --out-dir <destination> --dry-run",
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseImportArguments(process.argv.slice(2));
    if (!options.input || !options.outDir) {
      usage();
      process.exitCode = 1;
    } else {
      printResult(
        mintImportedProject(ROOT, options.input, options.outDir, {
          dryRun: options.dryRun,
        }),
      );
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
