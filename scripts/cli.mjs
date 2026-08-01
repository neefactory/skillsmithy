#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const commands = new Map([
  ["mint", { script: "mint.mjs", projectCommand: false }],
  ["import", { script: "import.mjs", projectCommand: false }],
  ["add-skill", { script: "add-skill.mjs", projectCommand: true }],
  ["build", { script: "build.mjs", projectCommand: true }],
  ["validate", { script: "validate.mjs", projectCommand: true }],
  ["check", { script: "check.mjs", projectCommand: true }],
  ["doctor", { script: "doctor.mjs", projectCommand: true }],
  ["migrate", { script: "migrate.mjs", projectCommand: true }],
]);

const [, , commandName, ...args] = process.argv;
const command = commands.get(commandName);

if (!command) {
  console.error(
    "Usage: skillsmithy <mint|import|add-skill|build|validate|check|doctor|migrate> [options]",
  );
  process.exitCode = 1;
} else {
  // Every command states the root it means: a project command targets the
  // working directory, and a template command deliberately targets the package
  // itself. A script reached without the CLI sets neither, which lets the
  // library refuse to treat an installed dependency as somebody's project.
  if (command.projectCommand) {
    process.env.SKILL_SMITHY_PROJECT_ROOT = process.cwd();
    delete process.env.SKILL_SMITHY_TEMPLATE_ROOT;
  } else {
    delete process.env.SKILL_SMITHY_PROJECT_ROOT;
    process.env.SKILL_SMITHY_TEMPLATE_ROOT = packageRoot;
  }
  const scriptPath = path.join(packageRoot, "scripts", command.script);
  process.argv = [process.argv[0], scriptPath, ...args];
  await import(pathToFileURL(scriptPath).href);
}
