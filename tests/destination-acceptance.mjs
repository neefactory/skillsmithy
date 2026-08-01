import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mintProject } from "../scripts/mint.mjs";
import { ROOT } from "../scripts/lib.mjs";

const MIT_ZERO = `MIT No Attribution

Copyright 2026 Skill Smithy

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "skillsmithy-destination-"),
);
const destination = path.join(temporaryRoot, "sample-skill");

try {
  mintProject(ROOT, "sample-skill", destination);
  authorSampleProject(destination);
  runNpm(
    [
      "install",
      "--save-dev",
      "--save-exact",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      ROOT,
    ],
    destination,
  );
  runNpm(["run", "build"], destination);
  assertClawHubWorkflow(destination);
  runNpm(["test"], destination);
  runNpm(["run", "doctor"], destination);
  console.log("Minted destination acceptance test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function authorSampleProject(root) {
  const configPath = path.join(root, "skill.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  Object.assign(config, {
    shortDescription: "Handle representative sample requests",
    description:
      "Handle representative sample requests with a concise, repeatable workflow.",
    defaultPrompt: "Use $sample-skill to handle this representative request.",
    marketplaceDescription:
      "A portable sample skill used to verify destination project tooling.",
    owner: {
      name: "Skill Smithy",
      email: "skills@example.org",
      url: "https://github.com/openai",
    },
    repo: "openai/sample-skill",
    clawhub: {
      githubActions: "manual",
      publishBranch: "main",
    },
  });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const skillRoot = path.join(root, "skills", "sample-skill");
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    "---\n" +
      "name: sample-skill\n" +
      "description: Handle representative sample requests with a concise, repeatable workflow.\n" +
      "---\n\n" +
      "# Sample Skill\n\n" +
      "Handle the request, verify the result, and report the completed outcome.\n",
  );
  fs.mkdirSync(path.join(skillRoot, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "agents", "openai.yaml"),
    "interface:\n" +
      '  display_name: "Sample Skill"\n' +
      '  short_description: "Handle representative sample requests"\n' +
      '  default_prompt: "Use $sample-skill to handle this representative request."\n',
  );
  fs.writeFileSync(
    path.join(root, "README.md"),
    "# Sample Skill\n\nA destination-project fixture for Skill Smithy CI.\n",
  );
  // Mint leaves `license` at MIT-0 and copies no LICENSE, so an authored
  // destination writes the matching file the way an agent is instructed to.
  fs.writeFileSync(path.join(root, "LICENSE"), MIT_ZERO);
}

function assertClawHubWorkflow(root) {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "clawhub-publish.yml"),
    "utf8",
  );
  if (
    !workflow.includes(
      "uses: openclaw/clawhub/.github/workflows/skill-publish.yml@main",
    ) ||
    !workflow.includes("workflow_dispatch:") ||
    !workflow.includes("secrets.CLAWHUB_TOKEN")
  ) {
    throw new Error("Minted destination did not generate the ClawHub workflow.");
  }
}

function runNpm(args, cwd) {
  const windowsNpmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const command =
    process.platform === "win32" && fs.existsSync(windowsNpmCli)
      ? process.execPath
      : "npm";
  const commandArgs = command === process.execPath
    ? [windowsNpmCli, ...args]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
}
