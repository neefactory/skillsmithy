import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, compareGenerated, ignoredGeneratedPaths } from "./lib.mjs";
import { buildProject } from "./generate.mjs";

// Build into an isolated directory. The working tree is never rebuilt, backed
// up, restored, or decoded as text, so failures cannot delete or corrupt files.
const generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skillsmithy-check-"));

try {
  buildProject(ROOT, generatedRoot);

  // Ignored paths are absent from a fresh clone while a build still produces
  // them, so the comparison leaves them out. Reporting them keeps the success
  // line from reading as a guarantee about the whole of GENERATED_PATHS.
  const skipped = [...ignoredGeneratedPaths(ROOT)].sort();
  const differences = compareGenerated(ROOT, generatedRoot);
  if (differences.length) {
    console.error("Generated output is stale. Run `npm run build` and commit:");
    for (const difference of differences) console.error(`  - ${difference}`);
    process.exitCode = 1;
  } else {
    console.log("Generated output is byte-for-byte up to date.");
  }
  if (skipped.length) {
    console.log(
      `Not compared because the repository ignores them: ${skipped.join(", ")}.`,
    );
  }
} finally {
  fs.rmSync(generatedRoot, { recursive: true, force: true });
}
