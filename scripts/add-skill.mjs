import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeProjectDocs, importSkill } from "./import-skill.mjs";
import { initializeProject } from "./init-project.mjs";
import { ROOT, loadConfig } from "./lib.mjs";

export function addSkillToProject(
  root,
  { name = null, from = null, bundleName = null, dryRun = false } = {},
) {
  if ((!name && !from) || (name && from)) {
    throw new Error("Provide exactly one skill name or --from source.");
  }
  if (dryRun && !from) {
    throw new Error("--dry-run is available only with --from.");
  }

  const config = loadConfig(root);
  if (config.template) {
    throw new Error(
      "add-skill must run inside a project previously created by mint or import.",
    );
  }

  if (from) {
    return importSkill(root, from, { bundleName, dryRun });
  }

  return initializeProject(root, {
    name,
    add: true,
    bundleName,
  });
}

export function parseAddSkillArguments(args) {
  const parsed = {
    name: null,
    from: null,
    bundleName: null,
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      parsed.from = args[index + 1];
      if (!parsed.from) throw new Error("--from requires a path.");
      index += 1;
    } else if (arg === "--bundle") {
      parsed.bundleName = args[index + 1];
      if (!parsed.bundleName) {
        throw new Error("--bundle requires a plugin name.");
      }
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
  return parsed;
}

function printResult(result, root) {
  if (result.dryRun) {
    console.log("Dry run: no files were written.");
    console.log(`Would add ${result.source}`);
    console.log(`Canonical destination: ${result.destination}`);
    console.log(`Mode: ${result.mode}; plugin: ${result.pluginName}`);
    for (const note of describeProjectDocs(result)) console.log(note);
    return;
  }

  if (result.imported) {
    console.log(
      `Imported "${result.name}" at ${path.relative(root, result.destination)}`,
    );
    console.log("The supplied skill and canonical copy were not edited.");
    for (const note of describeProjectDocs(result)) console.log(note);
    for (const warning of result.warnings) {
      console.warn(`Validation warning: ${warning}`);
    }
    for (const error of result.errors) {
      console.warn(`Validation finding: ${error}`);
    }
  } else {
    console.log(
      `Created canonical skill at ${path.relative(root, result.destination)}`,
    );
  }
  console.log("Next: author only canonical content, then run `npm run build` and `npm test`.");
}

function usage() {
  console.error("Usage:");
  console.error(
    "  npm run add-skill -- <skill-name> --bundle <plugin-name>  # first extra skill",
  );
  console.error(
    "  npm run add-skill -- --from <path> --bundle <plugin-name>  # import first extra skill",
  );
  console.error(
    "  npm run add-skill -- <skill-name>                         # established bundle",
  );
  console.error(
    "  npm run add-skill -- --from <path>                        # established bundle",
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseAddSkillArguments(process.argv.slice(2));
    if (!options.name && !options.from) {
      usage();
      process.exitCode = 1;
    } else {
      printResult(addSkillToProject(ROOT, options), ROOT);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
