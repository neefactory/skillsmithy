import fs from "node:fs";
import path from "node:path";
import { buildProject } from "./generate.mjs";
import { ROOT } from "./lib.mjs";

const destinationRoot = parseOutDir(process.argv.slice(2));

try {
  const result = buildProject(ROOT, destinationRoot);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);

  const { config, skills } = result.project;
  console.log(
    `Built ${skills.length} skill(s) as plugin "${config.pluginName}" ` +
      `in ${path.relative(ROOT, destinationRoot) || "."}`,
  );
  for (const [target, enabled] of Object.entries(config.targets)) {
    if (enabled) console.log(`  ✓ ${target}`);
  }
  if (["manual", "push"].includes(config.clawhub?.githubActions)) {
    console.log(`  ✓ clawhub-actions (${config.clawhub.githubActions})`);
  }
} catch (error) {
  for (const line of error.message.split("\n")) console.error(`Error: ${line}`);
  process.exitCode = 1;
}

function parseOutDir(args) {
  let output = ROOT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out-dir") {
      const value = args[index + 1];
      if (!value) fail("--out-dir requires a path.");
      output = path.resolve(value);
      index += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  fs.mkdirSync(output, { recursive: true });
  return output;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
