import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, validateProject } from "./lib.mjs";
import { buildProject } from "./generate.mjs";

const result = validateProject(ROOT);
for (const warning of result.warnings) console.warn(`Warning: ${warning}`);

if (result.errors.length) {
  for (const error of result.errors) console.error(`Error: ${error}`);
  process.exit(1);
}

const output = fs.mkdtempSync(path.join(os.tmpdir(), "skillsmithy-validate-"));
try {
  buildProject(ROOT, output);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

if (result.project.config.template) {
  console.log(
    "Template structure is valid. Use `npm run mint` or `npm run import` with `--out-dir` to create an independent project.",
  );
} else {
  console.log(
    `Validated ${result.project.skills.length} canonical skill(s), ClawHub preflights, and all generated adapters.`,
  );
}
