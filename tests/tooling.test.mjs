import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  assertGeneratedPathsWritable,
  compareGenerated,
  copyTree,
  ignoredGeneratedPaths,
  listTrackedDiscoveryFiles,
  parseSkillFile,
  replaceGenerated,
  validateProject,
} from "../scripts/lib.mjs";
import {
  addSkillToProject,
  parseAddSkillArguments,
} from "../scripts/add-skill.mjs";
import { buildProject } from "../scripts/generate.mjs";
import { parseImportArguments } from "../scripts/import.mjs";
import {
  describeProjectDocs,
  importSkill,
} from "../scripts/import-skill.mjs";
import { initializeProject } from "../scripts/init-project.mjs";
import {
  mintImportedProject,
  mintProject,
  parseMintArguments,
} from "../scripts/mint.mjs";
import {
  migrateProject,
  planMigration,
} from "../scripts/migrate.mjs";

test("ROOT resolves correctly from a file URL on this platform", () => {
  const expected = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  assert.equal(ROOT, expected);
  assert.equal(fs.existsSync(path.join(ROOT, "skill.config.json")), true);
});

test("SKILL.md parser accepts CRLF and nested portable YAML", () => {
  withTempDir((directory) => {
    const skillPath = path.join(directory, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: nested-skill",
        "description: Handles nested metadata when testing skills.",
        "metadata:",
        "  openclaw:",
        "    requires:",
        "      bins:",
        "        - jq",
        "---",
        "",
        "Follow the nested workflow.",
        "",
      ].join("\r\n"),
    );

    const parsed = parseSkillFile(skillPath);
    assert.deepEqual(parsed.frontmatter.metadata.openclaw.requires.bins, ["jq"]);
    assert.match(parsed.body, /Follow the nested workflow/);
  });
});

test("Hermes metadata and platform restrictions are accepted without injection", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const skillPath = path.join(directory, "skills", "alpha", "SKILL.md");
    fs.writeFileSync(
      skillPath,
      "---\n" +
        "name: alpha\n" +
        "description: Perform the alpha workflow with optional Hermes metadata.\n" +
        "platforms: [windows, linux]\n" +
        "metadata:\n" +
        "  hermes:\n" +
        "    tags: [automation, testing]\n" +
        "    related_skills: [beta]\n" +
        "    requires_toolsets: [terminal]\n" +
        "    requires_tools: [bash]\n" +
        "    fallback_for_toolsets: [browser]\n" +
        "    fallback_for_tools: [fetch]\n" +
        "    blueprint:\n" +
        "      schedule: daily\n" +
        "    config:\n" +
        "      - key: alpha.region\n" +
        "        description: Deployment region\n" +
        "        default: us-west\n" +
        "        prompt: Choose a deployment region\n" +
        "---\n\n" +
        "Perform the alpha workflow and verify the result.\n",
    );

    const validation = validateProject(directory);
    assert.deepEqual(validation.errors, []);
    assert.deepEqual(validation.warnings, []);
  });
});

test("metadata.hermes.category is flagged as unrecognized, not rejected", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    fs.writeFileSync(
      path.join(directory, "skills", "alpha", "SKILL.md"),
      "---\n" +
        "name: alpha\n" +
        "description: Hermes categorizes skills with tags, not a category field.\n" +
        "metadata:\n" +
        "  hermes:\n" +
        "    category: development\n" +
        "---\n\n" +
        "Perform the alpha workflow.\n",
    );

    const validation = validateProject(directory);

    assert.deepEqual(validation.errors, []);
    assert.match(
      validation.warnings.join("\n"),
      /metadata\.hermes\.category is not a recognized Hermes field/,
    );
  });
});

test("malformed recognized Hermes metadata is rejected", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const skillPath = path.join(directory, "skills", "alpha", "SKILL.md");
    fs.writeFileSync(
      skillPath,
      "---\n" +
        "name: alpha\n" +
        "description: Reject malformed recognized Hermes metadata fields.\n" +
        "platforms: [plan9]\n" +
        "metadata:\n" +
        "  hermes:\n" +
        "    tags: automation\n" +
        "    related_skills: [beta, 7]\n" +
        "    requires_toolsets: [terminal, 7]\n" +
        "    fallback_for_tools: fetch\n" +
        "    blueprint: [not-a-mapping]\n" +
        "    config:\n" +
        "      - description: Missing the required setting key\n" +
        "      - key: alpha.region\n" +
        "---\n\n" +
        "Do not accept malformed metadata.\n",
    );

    const errors = validateProject(directory).errors.join("\n");
    assert.match(errors, /platforms must be a non-empty array/);
    assert.match(errors, /metadata\.hermes\.tags must be an array/);
    assert.match(errors, /metadata\.hermes\.related_skills must be an array/);
    assert.match(errors, /metadata\.hermes\.requires_toolsets must be an array/);
    assert.match(errors, /metadata\.hermes\.fallback_for_tools must be an array/);
    assert.match(errors, /metadata\.hermes\.blueprint must be a YAML mapping/);
    assert.match(errors, /metadata\.hermes\.config\[0\]\.key must be a non-empty string/);
    assert.match(
      errors,
      /metadata\.hermes\.config\[1\]\.description must be a non-empty string/,
    );
  });
});

test("ClawHub metadata preflight validates runtime declarations", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const skillRoot = path.join(directory, "skills", "alpha");
    fs.mkdirSync(path.join(skillRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      "---\n" +
        "name: alpha\n" +
        "description: Validate OpenClaw runtime requirements before publishing.\n" +
        "metadata:\n" +
        "  openclaw:\n" +
        "    requires:\n" +
        "      env: API_TOKEN\n" +
        "      bins: [curl]\n" +
        "    primaryEnv: PRIMARY_TOKEN\n" +
        "    envVars:\n" +
        "      - name: OPTIONAL_REGION\n" +
        "        required: sometimes\n" +
        "    install:\n" +
        "      - kind: apt\n" +
        "---\n\nPerform the OpenClaw workflow.\n",
    );
    fs.writeFileSync(
      path.join(skillRoot, "scripts", "run.mjs"),
      'const token = process.env.SECRET_TOKEN;\n',
    );

    const validation = validateProject(directory);
    const errors = validation.errors.join("\n");
    const warnings = validation.warnings.join("\n");
    assert.match(errors, /requires\.env must be an array/);
    assert.match(errors, /envVars\[0\]\.required must be a boolean/);
    assert.match(errors, /install\[0\]\.kind must be brew, node, go, or uv/);
    assert.match(warnings, /primaryEnv "PRIMARY_TOKEN" is not declared/);
    assert.match(warnings, /references environment variable SECRET_TOKEN/);
  });
});

test("ClawHub preflight rejects unsupported licensing and pricing metadata", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const skillRoot = path.join(directory, "skills", "alpha");
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      "---\n" +
        "name: alpha\n" +
        "description: Reject metadata ClawHub does not publish.\n" +
        "license: Apache-2.0\n" +
        "price: 10\n" +
        "---\n\nPerform the workflow.\n",
    );
    fs.writeFileSync(path.join(skillRoot, "LICENSE"), "Apache License 2.0\n");

    const validation = validateProject(directory);
    assert.match(
      validation.errors.join("\n"),
      /does not support a frontmatter license override/,
    );
    assert.match(
      validation.errors.join("\n"),
      /does not support paid-skill metadata/,
    );
    assert.match(
      validation.warnings.join("\n"),
      /does not appear to grant MIT-0/,
    );
  });
});

test("ClawHub preflight reports bundles above the server size limit", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const largeAsset = path.join(
      directory,
      "skills",
      "alpha",
      "large-fixture.bin",
    );
    fs.writeFileSync(largeAsset, "");
    fs.truncateSync(largeAsset, 51 * 1024 * 1024);

    assert.match(
      validateProject(directory).warnings.join("\n"),
      /above ClawHub's 50 MB bundle limit/,
    );
  });
});

test("copyTree preserves binary contents and executable mode", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(source);
    const binary = path.join(source, "asset.bin");
    const script = path.join(source, "run.sh");
    fs.writeFileSync(binary, Buffer.from([0, 255, 1, 254, 2, 253]));
    fs.writeFileSync(script, "#!/bin/sh\nexit 0\n");
    if (process.platform !== "win32") fs.chmodSync(script, 0o755);

    copyTree(source, destination);

    assert.deepEqual(
      fs.readFileSync(path.join(destination, "asset.bin")),
      fs.readFileSync(binary),
    );
    if (process.platform !== "win32") {
      assert.equal(
        fs.statSync(path.join(destination, "run.sh")).mode & 0o777,
        0o755,
      );
    }
  });
});

test("copyTree skips excluded paths and prunes the directories they emptied", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(path.join(source, "agents"), { recursive: true });
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), "canonical\n");
    fs.writeFileSync(path.join(source, "agents", "openai.yaml"), "interface:\n");
    fs.writeFileSync(path.join(source, "agents", "keep.yaml"), "kept:\n");
    fs.writeFileSync(path.join(source, "references", "notes.md"), "notes\n");

    copyTree(source, destination, (relativePath) =>
      ["agents/openai.yaml", "references/notes.md"].includes(relativePath),
    );

    assert.equal(fs.existsSync(path.join(destination, "SKILL.md")), true);
    assert.equal(
      fs.existsSync(path.join(destination, "agents", "openai.yaml")),
      false,
    );
    // A sibling keeps the directory, so only the excluded file disappears.
    assert.equal(
      fs.existsSync(path.join(destination, "agents", "keep.yaml")),
      true,
    );
    // Nothing survived under references/, so the empty directory is not left
    // behind for git to drop and drift checking to then report as stale.
    assert.equal(fs.existsSync(path.join(destination, "references")), false);
    // The canonical source is never touched.
    assert.equal(
      fs.existsSync(path.join(source, "agents", "openai.yaml")),
      true,
    );
  });
});

test("Claude discovery copies omit openai.yaml while Codex and canonical keep it", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(source);
    writeProject(source, ["alpha"]);

    buildProject(source, destination);

    const claudeSkill = path.join(destination, ".claude", "skills", "alpha");
    const codexSkill = path.join(destination, ".agents", "skills", "alpha");
    assert.equal(fs.existsSync(path.join(claudeSkill, "SKILL.md")), true);
    // Claude never reads Codex product UI metadata, so a copy of it under
    // .claude/ only reads as a packaging mistake.
    assert.equal(
      fs.existsSync(path.join(claudeSkill, "agents", "openai.yaml")),
      false,
    );
    assert.equal(fs.existsSync(path.join(claudeSkill, "agents")), false);
    assert.equal(
      fs.existsSync(path.join(codexSkill, "agents", "openai.yaml")),
      true,
    );
    // The shipped artifact is skills/<name>/, which is unchanged.
    assert.equal(
      fs.existsSync(
        path.join(source, "skills", "alpha", "agents", "openai.yaml"),
      ),
      true,
    );
    // The exclusion is deterministic, so drift checking still passes.
    const rebuild = path.join(directory, "rebuild");
    buildProject(source, rebuild);
    assert.deepEqual(compareGenerated(destination, rebuild), []);
  });
});

test("single mode rejects a second skill and bundle mode accepts it", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    assert.deepEqual(validateProject(directory).errors, []);

    writeSkill(directory, "beta");
    assert.match(
      validateProject(directory).errors.join("\n"),
      /mode "single" requires exactly one skill/,
    );

    const configPath = path.join(directory, "skill.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.mode = "bundle";
    config.pluginName = "alpha-suite";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    assert.deepEqual(validateProject(directory).errors, []);
  });
});

test("internal initializer supports staged initialization and bundle additions", () => {
  withTempDir((directory) => {
    writeTemplateProject(directory);

    initializeProject(directory, { name: "alpha" });
    assert.equal(
      fs.existsSync(path.join(directory, "skills", "alpha", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(directory, "skills", "example-skill")),
      false,
    );
    const alphaSkill = fs.readFileSync(
      path.join(directory, "skills", "alpha", "SKILL.md"),
      "utf8",
    );
    assert.doesNotMatch(alphaSkill, /^platforms:/m);
    assert.doesNotMatch(alphaSkill, /^\s+hermes:/m);

    initializeProject(directory, {
      name: "beta",
      add: true,
      bundleName: "alpha-suite",
    });
    const config = JSON.parse(
      fs.readFileSync(path.join(directory, "skill.config.json"), "utf8"),
    );
    assert.equal(config.mode, "bundle");
    assert.equal(config.pluginName, "alpha-suite");
    assert.equal(
      fs.existsSync(path.join(directory, "skills", "beta", "SKILL.md")),
      true,
    );
  });
});

test("generated replacement preserves unrelated parent-directory content", () => {
  withTempDir((directory) => {
    const destination = path.join(directory, "destination");
    const stage = path.join(directory, "stage");
    fs.mkdirSync(path.join(destination, ".agents", "skills"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(destination, ".agents"), { recursive: true });
    fs.writeFileSync(path.join(destination, ".agents", "custom.txt"), "keep");
    fs.writeFileSync(
      path.join(destination, ".agents", "skills", "old.txt"),
      "old",
    );
    fs.mkdirSync(path.join(stage, ".agents", "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(stage, ".agents", "skills", "new.txt"),
      "new",
    );

    replaceGenerated(destination, stage);

    assert.equal(
      fs.readFileSync(path.join(destination, ".agents", "custom.txt"), "utf8"),
      "keep",
    );
    assert.equal(
      fs.readFileSync(
        path.join(destination, ".agents", "skills", "new.txt"),
        "utf8",
      ),
      "new",
    );
    assert.equal(
      fs.existsSync(path.join(destination, ".agents", "skills", "old.txt")),
      false,
    );
  });
});

test("generated writability preflight identifies the protected path", () => {
  withTempDir((directory) => {
    const protectedPath = path.join(directory, ".agents", "skills");
    fs.mkdirSync(protectedPath, { recursive: true });

    assert.throws(
      () =>
        assertGeneratedPathsWritable(directory, (candidate) => {
          if (candidate === protectedPath) {
            const error = new Error("protected");
            error.code = "EPERM";
            throw error;
          }
        }),
      (error) => {
        assert.match(error.message, /"\.agents[\\/]skills"/);
        assert.match(error.message, /EPERM/);
        assert.match(error.message, /temporarily unload/);
        assert.match(error.message, /--out-dir/);
        return true;
      },
    );
  });
});

test("Hermes uses the minimal canonical layout without a generated adapter", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const output = path.join(directory, "output");
    fs.mkdirSync(source);
    writeProject(source, ["alpha"]);
    const canonicalSkill = path.join(source, "skills", "alpha", "SKILL.md");
    const minimalSkill =
      "---\n" +
      "name: alpha\n" +
      "description: Perform the alpha workflow from the canonical skill tree.\n" +
      "---\n\n" +
      "Perform the alpha workflow and report the result.\n";
    fs.writeFileSync(canonicalSkill, minimalSkill);

    const validation = validateProject(source);
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.project.config.targets.hermes, true);
    buildProject(source, output);

    const codex = JSON.parse(
      fs.readFileSync(
        path.join(output, ".codex-plugin", "plugin.json"),
        "utf8",
      ),
    );
    const marketplace = JSON.parse(
      fs.readFileSync(
        path.join(output, ".agents", "plugins", "marketplace.json"),
        "utf8",
      ),
    );

    assert.equal(codex.skills, "./skills/");
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].source.source, "local");
    assert.equal(fs.readFileSync(canonicalSkill, "utf8"), minimalSkill);
    assert.equal(fs.existsSync(path.join(output, ".openclaw")), false);
    assert.equal(fs.existsSync(path.join(output, ".hermes")), false);
    assert.deepEqual(compareGenerated(output, output), []);
  });
});

test("Hermes is required in the explicit target support matrix", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const configPath = path.join(directory, "skill.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    delete config.targets.hermes;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    assert.match(
      validateProject(directory).errors.join("\n"),
      /targets\.hermes must be a boolean/,
    );
  });
});

test("invalid source is rejected before existing generated output changes", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(source);
    writeProject(source, ["alpha", "beta"]);
    fs.mkdirSync(path.join(destination, ".agents", "skills"), {
      recursive: true,
    });
    const sentinel = path.join(destination, ".agents", "skills", "sentinel.bin");
    fs.writeFileSync(sentinel, Buffer.from([0, 1, 2, 255]));

    assert.throws(() => buildProject(source, destination), /mode "single"/);
    assert.deepEqual(fs.readFileSync(sentinel), Buffer.from([0, 1, 2, 255]));
  });
});

test("bundle mode packages multiple skills as one marketplace plugin", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(source);
    writeProject(source, ["alpha", "beta"]);
    const configPath = path.join(source, "skill.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.mode = "bundle";
    config.pluginName = "alpha-suite";
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    buildProject(source, destination);

    const marketplace = JSON.parse(
      fs.readFileSync(
        path.join(destination, ".agents", "plugins", "marketplace.json"),
        "utf8",
      ),
    );
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, "alpha-suite");
    assert.equal(
      fs.existsSync(
        path.join(destination, ".agents", "skills", "alpha", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(destination, ".agents", "skills", "beta", "SKILL.md"),
      ),
      true,
    );
  });
});

test("ClawHub GitHub Actions publishing is generated only when enabled", () => {
  withTempDir((directory) => {
    const workflowPath = path.join(
      directory,
      ".github",
      "workflows",
      "clawhub-publish.yml",
    );
    writeProject(directory, ["alpha"]);
    buildProject(directory, directory);
    assert.equal(fs.existsSync(workflowPath), false);

    updateConfig(directory, (config) => {
      config.clawhub = {
        githubActions: "manual",
        publishBranch: "main",
        owner: "acme.tools",
      };
    });
    buildProject(directory, directory);
    const manual = fs.readFileSync(workflowPath, "utf8");
    assert.match(manual, /workflow_dispatch:/);
    assert.doesNotMatch(manual, /^  push:/m);
    assert.match(manual, /owner: "acme\.tools"/);
    assert.match(
      manual,
      /uses: openclaw\/clawhub\/\.github\/workflows\/skill-publish\.yml@main/,
    );
    assert.match(manual, /clawhub_token: \$\{\{ secrets\.CLAWHUB_TOKEN \}\}/);

    updateConfig(directory, (config) => {
      config.clawhub.githubActions = "push";
      config.clawhub.publishBranch = "release";
    });
    buildProject(directory, directory);
    const automatic = fs.readFileSync(workflowPath, "utf8");
    assert.match(automatic, /^  push:/m);
    assert.match(automatic, /- "release"/);
    assert.match(automatic, /github\.event_name == 'push'/);

    updateConfig(directory, (config) => {
      config.clawhub.githubActions = "off";
    });
    buildProject(directory, directory);
    assert.equal(fs.existsSync(workflowPath), false);
  });
});

test("ClawHub Actions configuration requires a supported mode and owner", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    updateConfig(directory, (config) => {
      config.clawhub = {
        githubActions: "always",
        publishBranch: "release branch",
        owner: "@Acme",
      };
    });
    const malformed = validateProject(directory).errors.join("\n");
    assert.match(malformed, /githubActions must be "off", "manual", or "push"/);
    assert.match(malformed, /publishBranch must be a non-empty Git ref/);
    assert.match(malformed, /clawhub\.owner must be a 1-64 character lowercase/);

    updateConfig(directory, (config) => {
      config.clawhub = { githubActions: "manual" };
      config.targets.openclaw = false;
    });
    assert.match(
      validateProject(directory).errors.join("\n"),
      /ClawHub GitHub Actions require targets\.openclaw to be true/,
    );
  });
});

test("mint writes the destination ignore file from the packaged template", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    // npm renames a packaged `.gitignore` to `.npmignore`, so an installed
    // release has none and this file must never be the source of a
    // destination's ignores. A checkout that has one describes itself only.
    fs.writeFileSync(
      path.join(source, ".gitignore"),
      "checkout-only-entry\n.skillsmithy-mint-*\n",
    );

    mintProject(source, "minted-skill", destination);

    const ignored = fs
      .readFileSync(path.join(destination, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    assert.ok(ignored.includes(".claude/skills/"));
    assert.ok(ignored.includes(".agents/skills/"));
    // A destination installs its tooling, so this is the entry it cannot ship
    // without: the first `git add -A` would otherwise commit node_modules,
    // including the example skill inside the Skill Smithy package.
    assert.ok(ignored.includes("node_modules/"));
    assert.ok(ignored.includes(".claude/settings.local.json"));
    // `mint` cannot run in a destination, so its staging prefix is dead config
    // there. The prefixes `build` and `add-skill --from` use are not.
    assert.equal(ignored.includes(".skillsmithy-mint-*"), false);
    assert.ok(ignored.includes(".skillsmithy-stage-*"));
    assert.ok(ignored.includes(".skillsmithy-transaction-*"));
    assert.ok(ignored.includes(".skillsmithy-import-*"));
    assert.equal(ignored.includes("checkout-only-entry"), false);
    // The manifests installers actually read are never ignored.
    for (const entry of ignored) {
      assert.equal(entry.startsWith(".claude-plugin"), false);
      assert.equal(entry.startsWith(".codex-plugin"), false);
      assert.equal(entry.startsWith(".agents/plugins"), false);
    }
    // The copies are still generated; they are local, not absent.
    assert.equal(
      fs.existsSync(
        path.join(destination, ".claude", "skills", "minted-skill", "SKILL.md"),
      ),
      true,
    );

    const gitCaptureProbe = spawnSync("git", ["--version"], {
      encoding: "utf8",
    });
    if (!gitCaptureProbe.error) {
      assert.equal(
        spawnSync("git", ["init", "-q", "."], {
          cwd: destination,
          stdio: "ignore",
        }).status,
        0,
      );
      fs.mkdirSync(
        path.join(destination, "node_modules", "skillsmithy-template"),
        { recursive: true },
      );
      fs.writeFileSync(
        path.join(
          destination,
          "node_modules",
          "skillsmithy-template",
          "package.json",
        ),
        "{}\n",
      );
      for (const generatedSkill of [
        ".claude/skills/minted-skill/SKILL.md",
        ".agents/skills/minted-skill/SKILL.md",
        "node_modules/skillsmithy-template/package.json",
      ]) {
        assert.equal(
          spawnSync("git", ["check-ignore", "-q", generatedSkill], {
            cwd: destination,
            stdio: "ignore",
          }).status,
          0,
          generatedSkill,
        );
      }
      assert.equal(
        spawnSync("git", ["add", "."], {
          cwd: destination,
          stdio: "ignore",
        }).status,
        0,
      );
      const trackedResult = spawnSync("git", ["ls-files"], {
        cwd: destination,
        encoding: "utf8",
      });
      assert.equal(trackedResult.status, 0);
      const tracked = trackedResult.stdout;
      assert.doesNotMatch(tracked, /^\.claude\/skills\//m);
      assert.doesNotMatch(tracked, /^\.agents\/skills\//m);
      assert.doesNotMatch(tracked, /^node_modules\//m);
    }
  });
});

test("validation rejects discovery copies already tracked by an older project", (t) => {
  if (spawnSync("git", ["--version"], { encoding: "utf8" }).error) {
    t.skip("captured Git output is unavailable");
    return;
  }
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    buildProject(directory, directory);
    fs.writeFileSync(
      path.join(directory, ".gitignore"),
      ".claude/skills/\n.agents/skills/\n",
    );
    assert.equal(
      spawnSync("git", ["init", "-q", "."], {
        cwd: directory,
        stdio: "ignore",
      }).status,
      0,
    );
    assert.equal(
      spawnSync(
        "git",
        [
          "add",
          "-f",
          ".claude/skills/alpha/SKILL.md",
          ".agents/skills/alpha/SKILL.md",
        ],
        { cwd: directory, stdio: "ignore" },
      ).status,
      0,
    );

    assert.match(
      validateProject(directory).errors.join("\n"),
      /Generated discovery copies are tracked by Git/,
    );
  });
});

test("tracked discovery-copy detection is scoped to the project Git root", () => {
  withTempDir((directory) => {
    const tracked = listTrackedDiscoveryFiles(
      directory,
      (_command, args) => {
        if (args[0] === "rev-parse") {
          return { status: 0, stdout: `${directory}\n` };
        }
        return {
          status: 0,
          stdout:
            ".agents/skills/alpha/SKILL.md\n" +
            ".claude/skills/alpha/SKILL.md\n",
        };
      },
    );
    assert.deepEqual(tracked, [
      ".agents/skills/alpha/SKILL.md",
      ".claude/skills/alpha/SKILL.md",
    ]);

    const nested = listTrackedDiscoveryFiles(
      directory,
      () => ({
        status: 0,
        stdout: `${path.dirname(directory)}\n`,
      }),
    );
    assert.deepEqual(nested, []);
  });
});

test("drift checking skips generated paths the repository ignores", (t) => {
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).error) {
    t.skip("git is unavailable");
    return;
  }
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const built = path.join(directory, "built");
    const fresh = path.join(directory, "fresh");
    fs.mkdirSync(source);
    writeProject(source, ["alpha"]);
    buildProject(source, built);
    buildProject(source, fresh);
    assert.deepEqual(compareGenerated(built, fresh), []);

    fs.writeFileSync(
      path.join(built, ".gitignore"),
      ".claude/skills/\n.agents/skills/\n",
    );
    assert.equal(
      spawnSync("git", ["init", "-q", "."], { cwd: built, stdio: "ignore" })
        .status,
      0,
    );
    // `check` prints this set, so a comparison narrowed by the project's own
    // ignores is stated rather than reported as a complete run.
    assert.deepEqual([...ignoredGeneratedPaths(built)].sort(), [
      ".agents/skills",
      ".claude/skills",
    ]);
    // A fresh clone of a project that ignores its discovery copies has the
    // manifests and nothing else, so those paths must not read as drift.
    fs.rmSync(path.join(built, ".claude", "skills"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(built, ".agents", "skills"), {
      recursive: true,
      force: true,
    });
    assert.deepEqual(compareGenerated(built, fresh), []);

    // Ignoring the copies must not blind the check to a stale manifest.
    fs.rmSync(path.join(built, ".claude-plugin", "plugin.json"));
    assert.deepEqual(compareGenerated(built, fresh), [
      ".claude-plugin/plugin.json",
    ]);
  });
});

test("validation warns when a generated manifest is gitignored", (t) => {
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).error) {
    t.skip("git is unavailable");
    return;
  }
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    buildProject(directory, directory);
    // `.claude-plugin/` is the mistake being caught; `.github/` is the broad
    // rule that usually causes it, and this project generates no workflow.
    fs.writeFileSync(
      path.join(directory, ".gitignore"),
      ".claude/skills/\n.agents/skills/\n.claude-plugin/\n.github/\n",
    );
    assert.equal(
      spawnSync("git", ["init", "-q", "."], {
        cwd: directory,
        stdio: "ignore",
      }).status,
      0,
    );

    const warnings = validateProject(directory).warnings.join("\n");
    assert.match(
      warnings,
      /\.claude-plugin\/plugin\.json is generated but ignored by Git/,
    );
    assert.match(
      warnings,
      /\.claude-plugin\/marketplace\.json is generated but ignored by Git/,
    );
    // Discovery copies are ignored deliberately, so reporting them would train
    // the author to ignore the warning that matters.
    assert.doesNotMatch(warnings, /skills is generated but ignored by Git/);
    // An ignored path this project never generates is not a finding.
    assert.doesNotMatch(
      warnings,
      /clawhub-publish\.yml is generated but ignored by Git/,
    );
  });
});

test("mint creates an independent initialized project without changing source", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    const sourceBefore = snapshotProjectFiles(source);

    const result = mintProject(source, "minted-skill", destination);

    assert.equal(result.destination, destination);
    assert.equal(
      fs.existsSync(path.join(destination, "skills", "minted-skill", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(destination, "skills", "example-skill")),
      false,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          destination,
          ".agents",
          "skills",
          "minted-skill",
          "SKILL.md",
        ),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(destination, ".agents", "skills", "example-skill"),
      ),
      false,
    );
    assert.equal(fs.existsSync(path.join(destination, ".git")), false);
    assert.equal(fs.existsSync(path.join(destination, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(destination, "README.md")), false);
    assert.equal(
      fs.readFileSync(path.join(destination, "CLAUDE.md"), "utf8"),
      "@AGENTS.md\n",
    );
    // The destination receives the authoring contract, not Skill Smithy's own
    // playbook, and never the template directory that holds it.
    assert.equal(
      fs.readFileSync(path.join(destination, "AGENTS.md"), "utf8"),
      fs.readFileSync(
        path.join(source, "templates", "AGENTS.destination.md"),
        "utf8",
      ),
    );
    assert.equal(fs.existsSync(path.join(destination, "templates")), false);

    const config = JSON.parse(
      fs.readFileSync(path.join(destination, "skill.config.json"), "utf8"),
    );
    assert.equal(config.template, false);
    assert.equal(config.mode, "single");
    assert.equal(config.pluginName, "minted-skill");
    assert.equal(config.targets.hermes, true);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(destination, "package.json"), "utf8"),
    );
    assert.equal(packageJson.name, "minted-skill");
    assert.equal(
      packageJson.description,
      "Portable Agent Skill project for minted-skill.",
    );
    assert.equal(packageJson.scripts.init, undefined);
    assert.equal(packageJson.scripts.mint, undefined);
    assert.equal(packageJson.scripts.import, undefined);
    assert.equal(packageJson.scripts["add-skill"], "skillsmithy add-skill");
    assert.equal(packageJson.scripts.build, "skillsmithy build");
    assert.equal(packageJson.scripts.migrate, "skillsmithy migrate");
    assert.equal(packageJson.scripts.test, "npm run validate && npm run check");
    assert.equal(packageJson.version, "0.1.0");
    assert.equal(
      packageJson.devDependencies["skillsmithy-template"],
      "1.0.0",
    );
    assert.equal(fs.existsSync(path.join(destination, "package-lock.json")), false);
    assert.equal(fs.existsSync(path.join(destination, "scripts")), false);
    const provenance = JSON.parse(
      fs.readFileSync(
        path.join(destination, ".skillsmithy", "provenance.json"),
        "utf8",
      ),
    );
    assert.equal(provenance.package, "skillsmithy-template");
    assert.equal(provenance.version, "1.0.0");
    assert.ok(provenance.managedFiles["AGENTS.md"]);

    const codex = JSON.parse(
      fs.readFileSync(
        path.join(destination, ".codex-plugin", "plugin.json"),
        "utf8",
      ),
    );
    assert.equal(codex.name, "minted-skill");

    assertSnapshotsEqual(sourceBefore, snapshotProjectFiles(source));
  });
});

test("mint refuses a template with no destination authoring contract", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    fs.rmSync(path.join(source, "templates"), { recursive: true, force: true });

    assert.throws(
      () => mintProject(source, "minted-skill", destination),
      /AGENTS\.destination\.md/,
    );
    assert.equal(fs.existsSync(destination), false);
  });
});

test("mint refuses a template with no destination ignore file", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    fs.rmSync(path.join(source, "templates", ".gitignore.destination"));

    // Failing loudly beats minting a project that commits its own
    // node_modules the first time anyone runs `git add`.
    assert.throws(
      () => mintProject(source, "minted-skill", destination),
      /\.gitignore\.destination/,
    );
    assert.equal(fs.existsSync(destination), false);
  });
});

test("migration previews and applies a managed contract upgrade without touching skills", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    const upgraded = path.join(directory, "upgraded-package");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    copyTree(source, upgraded);

    const upgradedPackagePath = path.join(upgraded, "package.json");
    const upgradedPackage = JSON.parse(
      fs.readFileSync(upgradedPackagePath, "utf8"),
    );
    upgradedPackage.version = "1.1.0";
    fs.writeFileSync(
      upgradedPackagePath,
      `${JSON.stringify(upgradedPackage, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(upgraded, "templates", "AGENTS.destination.md"),
      "# Authoring contract\n\nUse dependency-managed tooling.\n",
    );

    const skillPath = path.join(
      destination,
      "skills",
      "minted-skill",
      "SKILL.md",
    );
    const skillBefore = fs.readFileSync(skillPath);
    const contractBefore = fs.readFileSync(
      path.join(destination, "AGENTS.md"),
      "utf8",
    );

    const preview = migrateProject(destination, upgraded, { dryRun: true });
    assert.equal(preview.applied, false);
    assert.equal(preview.fromVersion, "1.0.0");
    assert.equal(preview.toVersion, "1.1.0");
    assert.ok(
      preview.managed.some(
        (item) => item.path === "AGENTS.md" && item.action === "replace",
      ),
    );
    assert.equal(
      fs.readFileSync(path.join(destination, "AGENTS.md"), "utf8"),
      contractBefore,
    );

    const applied = migrateProject(destination, upgraded);
    assert.equal(applied.applied, true);
    assert.match(
      fs.readFileSync(path.join(destination, "AGENTS.md"), "utf8"),
      /dependency-managed tooling/,
    );
    assert.deepEqual(fs.readFileSync(skillPath), skillBefore);
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(destination, "package.json"), "utf8"),
    );
    assert.equal(packageJson.devDependencies["skillsmithy-template"], "1.1.0");
    const provenance = JSON.parse(
      fs.readFileSync(
        path.join(destination, ".skillsmithy", "provenance.json"),
        "utf8",
      ),
    );
    assert.equal(provenance.version, "1.1.0");
  });
});

test("migration refuses overlapping local and package changes to managed files", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    const upgraded = path.join(directory, "upgraded-package");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    copyTree(source, upgraded);

    const packagePath = path.join(upgraded, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.version = "2.0.0";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    fs.appendFileSync(
      path.join(upgraded, "templates", "AGENTS.destination.md"),
      "\nNew upstream rule.\n",
    );
    fs.appendFileSync(
      path.join(destination, "AGENTS.md"),
      "\nLocal project rule.\n",
    );

    const plan = planMigration(destination, upgraded);
    assert.deepEqual(
      plan.conflicts.map((item) => item.path),
      ["AGENTS.md"],
    );
    assert.throws(
      () => migrateProject(destination, upgraded),
      /managed-file conflicts: AGENTS\.md/,
    );
    assert.match(
      fs.readFileSync(path.join(destination, "AGENTS.md"), "utf8"),
      /Local project rule/,
    );
  });
});

test("a migration without provenance preserves local contract changes", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    fs.rmSync(path.join(destination, ".skillsmithy"), {
      recursive: true,
      force: true,
    });
    const projectPackagePath = path.join(destination, "package.json");
    const projectPackage = JSON.parse(
      fs.readFileSync(projectPackagePath, "utf8"),
    );
    delete projectPackage.devDependencies;
    delete projectPackage.scripts.migrate;
    projectPackage.scripts.build = "echo stale";
    fs.writeFileSync(
      projectPackagePath,
      `${JSON.stringify(projectPackage, null, 2)}\n`,
    );
    fs.appendFileSync(
      path.join(destination, "AGENTS.md"),
      "\nProject-specific authoring rule.\n",
    );

    const preview = migrateProject(destination, source, { dryRun: true });
    assert.equal(preview.bootstrap, true);
    assert.ok(
      preview.managed.some(
        (item) => item.path === "AGENTS.md" && item.action === "preserve",
      ),
    );

    migrateProject(destination, source);
    assert.match(
      fs.readFileSync(path.join(destination, "AGENTS.md"), "utf8"),
      /Project-specific authoring rule/,
    );
    const migratedPackage = JSON.parse(
      fs.readFileSync(projectPackagePath, "utf8"),
    );
    assert.equal(migratedPackage.scripts.build, "skillsmithy build");
    assert.equal(
      migratedPackage.devDependencies["skillsmithy-template"],
      "1.0.0",
    );
  });
});

test("migration refreshes managed fields and keeps project-owned ones", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    const upgraded = path.join(directory, "upgraded-package");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    copyTree(source, upgraded);
    bumpPackageVersion(upgraded, "1.1.0");

    const packagePath = path.join(destination, "package.json");
    const authored = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    // Everything an author may reasonably own, including a `test` script that
    // runs their own evaluations alongside the Skill Smithy checks.
    authored.scripts.test = "npm run validate && npm run check && node evals/run.mjs";
    authored.scripts.evals = "node evals/run.mjs";
    // The managed scripts themselves are left alone here: validation rejects a
    // project that renamed one, so migration's preflight build would refuse
    // before reaching the package write. Restoring a stale managed script is
    // covered by the migration that starts without provenance.
    authored.private = false;
    authored.files = ["skills/"];
    authored.bin = { "minted-skill": "./bin/cli.mjs" };
    authored.description = "A deliberately chosen description.";
    fs.writeFileSync(packagePath, `${JSON.stringify(authored, null, 2)}\n`);

    migrateProject(destination, upgraded);

    const migrated = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    assert.equal(
      migrated.scripts.test,
      "npm run validate && npm run check && node evals/run.mjs",
    );
    assert.equal(migrated.scripts.evals, "node evals/run.mjs");
    assert.equal(migrated.private, false);
    assert.deepEqual(migrated.files, ["skills/"]);
    assert.deepEqual(migrated.bin, { "minted-skill": "./bin/cli.mjs" });
    assert.equal(migrated.description, "A deliberately chosen description.");
    // The managed entries are still restored, so a project cannot drift out of
    // the contract validation enforces.
    assert.equal(migrated.scripts.build, "skillsmithy build");
    assert.equal(migrated.devDependencies["skillsmithy-template"], "1.1.0");
  });
});

test("migration restores a missing ignore entry without dropping additions", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    const upgraded = path.join(directory, "upgraded-package");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    copyTree(source, upgraded);
    bumpPackageVersion(upgraded, "1.1.0");

    const ignorePath = path.join(destination, ".gitignore");
    fs.writeFileSync(ignorePath, ".claude/skills/\n.agents/skills/\nfixtures/tmp/\n");

    migrateProject(destination, upgraded);

    const ignored = fs
      .readFileSync(ignorePath, "utf8")
      .split("\n")
      .map((line) => line.trim());
    assert.ok(ignored.includes("node_modules/"));
    assert.ok(ignored.includes("fixtures/tmp/"));
    // Entries already present are matched with or without a trailing slash, so
    // a migration never appends a duplicate.
    assert.equal(
      ignored.filter((line) => line === ".claude/skills/").length,
      1,
    );
  });
});

test("a tooling pin ahead of recorded provenance warns without failing", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);

    const packagePath = path.join(destination, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    packageJson.devDependencies["skillsmithy-template"] = "1.1.0";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const result = validateProject(destination);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.warnings.some((warning) =>
        /pins skillsmithy-template@1\.1\.0 but .*records 1\.0\.0/.test(warning),
      ),
      result.warnings.join("\n"),
    );

    // A range or local path names no single release, so it cannot disagree.
    packageJson.devDependencies["skillsmithy-template"] = "^1.0.0";
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    assert.equal(
      validateProject(destination).warnings.some((warning) =>
        warning.includes("records"),
      ),
      false,
    );
  });
});

test("migration rejects a modified managed-file baseline", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);
    mintProject(source, "minted-skill", destination);
    fs.appendFileSync(
      path.join(destination, ".skillsmithy", "baseline", "AGENTS.md"),
      "\nTampered baseline.\n",
    );

    assert.throws(
      () => planMigration(destination, source),
      /differs from its recorded provenance hash/,
    );
  });
});

test("the shipped destination contract omits template-only commands", () => {
  const contract = fs.readFileSync(
    path.join(ROOT, "templates", "AGENTS.destination.md"),
    "utf8",
  );
  // Naming `mint` and `import` to say they are unavailable is fine; telling a
  // destination to invoke a command its package.json does not define is not.
  assert.equal(
    /npm run (mint|import)\b/.test(contract),
    false,
    "the destination contract must not instruct running mint or import",
  );
  // Rules the destination needs must survive the split out of Skill Smithy's
  // own playbook, which is no longer copied.
  for (const heading of [
    "## Publisher identity is never inherited",
    "## Licensing",
    "## Required workflow",
    "## Single skill versus bundle",
    "## Validation commands",
    "## Completion criteria",
  ]) {
    assert.equal(
      contract.includes(heading),
      true,
      `the destination contract must keep "${heading}"`,
    );
  }
});

test("mint accepts an empty destination and refuses unsafe destinations", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const emptyDestination = path.join(directory, "empty-destination");
    const nonemptyDestination = path.join(directory, "nonempty-destination");
    writeTemplateProject(source);
    fs.mkdirSync(path.join(source, ".git"));
    fs.mkdirSync(path.join(source, "node_modules"));
    fs.mkdirSync(path.join(source, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(source, "debug.log"), "exclude");
    fs.writeFileSync(
      path.join(source, ".claude", "settings.local.json"),
      '{"permissions":{"allow":["Bash(rm *)"]}}',
    );
    fs.writeFileSync(path.join(source, "LICENSE"), "Copyright (c) Template");
    fs.writeFileSync(path.join(source, ".env"), "SECRET=leaked");
    fs.mkdirSync(path.join(source, ".github", "workflows"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(source, ".github", "workflows", "ci.yml"),
      "name: template-ci\n",
    );
    fs.mkdirSync(path.join(source, "tests"));
    fs.writeFileSync(path.join(source, "tests", "template.test.mjs"), "");
    fs.mkdirSync(path.join(source, "scripts"));
    for (const name of ["mint.mjs", "import.mjs", "lib.mjs"]) {
      fs.writeFileSync(path.join(source, "scripts", name), "export {};\n");
    }
    fs.mkdirSync(emptyDestination);
    fs.mkdirSync(nonemptyDestination);
    fs.writeFileSync(path.join(nonemptyDestination, "keep.txt"), "keep");

    mintProject(source, "alpha", emptyDestination);
    assert.equal(
      fs.existsSync(path.join(emptyDestination, "skills", "alpha", "SKILL.md")),
      true,
    );
    for (const excluded of [
      ".git",
      "node_modules",
      "debug.log",
      ".env",
      "LICENSE",
      ".github",
      "tests",
      "templates",
      path.join(".claude", "settings.local.json"),
      path.join("scripts", "mint.mjs"),
      path.join("scripts", "import.mjs"),
    ]) {
      assert.equal(
        fs.existsSync(path.join(emptyDestination, excluded)),
        false,
        `${excluded} must not be copied into a destination`,
      );
    }
    assert.equal(fs.existsSync(path.join(emptyDestination, "scripts")), false);
    assert.equal(
      fs.existsSync(
        path.join(emptyDestination, ".skillsmithy", "provenance.json"),
      ),
      true,
    );

    assert.throws(
      () => mintProject(source, "beta", nonemptyDestination),
      /not empty/,
    );
    assert.equal(
      fs.readFileSync(path.join(nonemptyDestination, "keep.txt"), "utf8"),
      "keep",
    );
    assert.throws(
      () => mintProject(source, "beta", path.join(source, "nested-output")),
      /must not be.*inside it/,
    );
  });
});

test("the pristine template generates manifests but no discovery copies", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const output = path.join(directory, "output");
    writeTemplateProject(source);
    fs.mkdirSync(path.join(source, "skills", "example-skill", "agents"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(source, "skills", "example-skill", "agents", "openai.yaml"),
      "interface:\n" +
        '  display_name: "Example Skill"\n' +
        '  short_description: "Template for one polished agent skill"\n' +
        '  default_prompt: "Use $example-skill to demonstrate the workflow."\n',
    );

    buildProject(source, output);

    assert.equal(fs.existsSync(path.join(output, ".claude", "skills")), false);
    assert.equal(fs.existsSync(path.join(output, ".agents", "skills")), false);
    assert.equal(
      fs.existsSync(path.join(output, ".claude-plugin", "marketplace.json")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(output, ".codex-plugin", "plugin.json")),
      true,
    );
    assert.deepEqual(compareGenerated(output, output), []);
  });
});

test("author keywords widen both plugin manifests without dropping skill names", () => {
  withTempDir((directory) => {
    const output = path.join(directory, "output");
    writeProject(directory, ["alpha"]);

    // Absent is the documented default, and it must generate exactly what a
    // project produced before the field existed.
    buildProject(directory, output);
    for (const manifest of readPluginManifests(output)) {
      assert.deepEqual(manifest.keywords, ["alpha"]);
    }

    updateConfig(directory, (config) => {
      config.keywords = ["release notes", "changelog", "git history"];
    });
    buildProject(directory, output);

    for (const manifest of readPluginManifests(output)) {
      assert.deepEqual(manifest.keywords, [
        "alpha",
        "release notes",
        "changelog",
        "git history",
      ]);
    }
    assert.deepEqual(compareGenerated(output, output), []);
  });
});

test("malformed keywords are rejected before anything is generated", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const invalid = [
      ["Release Notes"],
      ["TODO: add discovery terms"],
      ["release_notes"],
      ["x"],
      ["changelog", "changelog"],
      Array.from({ length: 13 }, (_, index) => `term-${index}`),
      "release notes",
    ];

    for (const keywords of invalid) {
      updateConfig(directory, (config) => {
        config.keywords = keywords;
      });
      const validation = validateProject(directory);
      assert.equal(
        validation.errors.length > 0,
        true,
        `expected ${JSON.stringify(keywords)} to be rejected`,
      );
      assert.match(validation.errors.join("\n"), /keyword/);
    }
  });
});

test("a keyword restating a canonical skill name is rejected as dead config", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    updateConfig(directory, (config) => {
      config.keywords = ["alpha", "release notes"];
    });

    const validation = validateProject(directory);

    assert.match(
      validation.errors.join("\n"),
      /keyword\(s\) "alpha" already reach the generated manifests/,
    );
  });
});

test("scaffold placeholders are reported as warnings, never as errors", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    const skillPath = path.join(directory, "skills", "alpha", "SKILL.md");
    fs.writeFileSync(
      skillPath,
      "---\n" +
        "name: alpha\n" +
        'description: "Triage TODO: comments left behind in a codebase."\n' +
        "---\n\n" +
        "TODO: finish documenting step one and step two of the workflow.\n",
    );

    const validation = validateProject(directory);

    assert.deepEqual(validation.errors, []);
    assert.match(
      validation.warnings.join("\n"),
      /skills\/alpha\/SKILL\.md still contains scaffold placeholder text/,
    );
  });
});

test("legitimate skill prose is not mistaken for scaffold placeholders", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    fs.writeFileSync(
      path.join(directory, "skills", "alpha", "SKILL.md"),
      "---\n" +
        "name: alpha\n" +
        "description: Introduce yourself and record the person's details.\n" +
        "---\n\n" +
        "Step one: ask for your name. Step two: confirm the spelling.\n",
    );

    const validation = validateProject(directory);

    assert.deepEqual(validation.errors, []);
    assert.deepEqual(validation.warnings, []);
  });
});

test("a declared licence without a LICENSE file warns, never errors", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    fs.rmSync(path.join(directory, "LICENSE"));

    const validation = validateProject(directory);

    assert.deepEqual(validation.errors, []);
    assert.match(
      validation.warnings.join("\n"),
      /declares license "MIT" but the project root has no LICENSE file/,
    );

    fs.writeFileSync(path.join(directory, "license.md"), "MIT License\n");
    assert.deepEqual(validateProject(directory).warnings, []);
  });
});

test("mint resets publisher identity a customized checkout carries", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "minted-skill");
    writeTemplateProject(source);

    // A fork of Skill Smithy whose author already filled in their own details.
    const configPath = path.join(source, "skill.config.json");
    const templateSettings = JSON.parse(fs.readFileSync(configPath, "utf8"));
    templateSettings.license = "Apache-2.0";
    templateSettings.owner = {
      name: "Template Author",
      email: "author@example.org",
      url: "https://github.com/template-author",
    };
    templateSettings.repo = "template-author/skillsmithy";
    templateSettings.keywords = ["forked template term"];
    templateSettings.clawhub = {
      githubActions: "push",
      publishBranch: "release",
      owner: "template-author",
    };
    fs.writeFileSync(configPath, `${JSON.stringify(templateSettings, null, 2)}\n`);

    mintProject(source, "minted-skill", destination);

    const config = JSON.parse(
      fs.readFileSync(path.join(destination, "skill.config.json"), "utf8"),
    );
    assert.deepEqual(config.owner, {
      name: "Your Name",
      url: "https://github.com/your-handle",
    });
    assert.equal(config.repo, "your-handle/your-repo");
    assert.equal(config.license, "MIT-0");
    assert.deepEqual(config.clawhub, {
      githubActions: "off",
      publishBranch: "main",
    });
    assert.equal(fs.existsSync(path.join(destination, "LICENSE")), false);

    // Keywords describe one product, so the fork's terms are dropped rather
    // than shipped in manifests describing a different skill.
    assert.equal("keywords" in config, false);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(destination, ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.keywords, ["minted-skill"]);

    // Nothing identifying the checkout's author reaches the destination.
    const generated = fs.readFileSync(
      path.join(destination, ".claude-plugin", "marketplace.json"),
      "utf8",
    );
    assert.equal(/Template Author|template-author|author@example\.org/.test(generated), false);
  });
});

test("import resets publisher identity for an imported project", () => {
  withTempDir((directory) => {
    const template = path.join(directory, "template");
    const source = path.join(directory, "existing-skill");
    const destination = path.join(directory, "imported");
    writeTemplateProject(template);

    const configPath = path.join(template, "skill.config.json");
    const templateSettings = JSON.parse(fs.readFileSync(configPath, "utf8"));
    templateSettings.license = "Apache-2.0";
    templateSettings.owner = {
      name: "Template Author",
      url: "https://github.com/template-author",
    };
    templateSettings.repo = "template-author/skillsmithy";
    templateSettings.keywords = ["forked template term"];
    fs.writeFileSync(configPath, `${JSON.stringify(templateSettings, null, 2)}\n`);

    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\n" +
        "name: existing-skill\n" +
        "description: Perform the existing workflow for realistic requests.\n" +
        "---\n\nPerform the existing workflow.\n",
    );

    mintImportedProject(template, source, destination);

    const config = JSON.parse(
      fs.readFileSync(path.join(destination, "skill.config.json"), "utf8"),
    );
    assert.deepEqual(config.owner, {
      name: "Your Name",
      url: "https://github.com/your-handle",
    });
    assert.equal(config.repo, "your-handle/your-repo");
    assert.equal(config.license, "MIT-0");
    assert.equal("keywords" in config, false);
  });
});

test("mint only runs from a pristine template", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    fs.mkdirSync(source);
    writeProject(source, ["alpha"]);

    assert.throws(
      () => mintProject(source, "beta", destination),
      /pristine Skill Smithy template/,
    );
    assert.equal(fs.existsSync(destination), false);
  });
});

test("mint CLI accepts the documented command shape", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "template");
    const destination = path.join(directory, "cli-skill");
    writeTemplateProject(source);
    const options = parseMintArguments([
      "cli-skill",
      "--out-dir",
      destination,
    ]);

    assert.deepEqual(options, {
      name: "cli-skill",
      from: null,
      outDir: destination,
      dryRun: false,
    });
    mintProject(source, options.name, options.outDir);
    assert.equal(
      fs.existsSync(path.join(destination, "skills", "cli-skill", "SKILL.md")),
      true,
    );
  });
});

test("mint --from creates an external byte-preserving imported project", () => {
  withTempDir((directory) => {
    const template = path.join(directory, "template");
    const source = path.join(directory, "existing-skill");
    const destination = path.join(directory, "imported-project");
    writeTemplateProject(template);
    fs.mkdirSync(path.join(source, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "Skill.md"),
      "---\r\n" +
        "name: imported-project\r\n" +
        "description: Preserve this complete skill in an external project.\r\n" +
        "---\r\n\r\n" +
        "Use assets/data.bin.\r\n",
    );
    fs.writeFileSync(
      path.join(source, "assets", "data.bin"),
      Buffer.from([0, 255, 13, 10]),
    );
    const sourceBefore = snapshotFiles(source);
    const templateBefore = snapshotProjectFiles(template);

    const result = mintImportedProject(template, source, destination);

    assert.equal(result.name, "imported-project");
    assert.equal(result.imported, true);
    assert.equal(
      fs.existsSync(
        path.join(destination, "skills", "imported-project", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          destination,
          ".agents",
          "skills",
          "imported-project",
          "SKILL.md",
        ),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(destination, "skills", "example-skill")),
      false,
    );
    assert.equal(fs.existsSync(path.join(destination, "README.md")), false);
    const importedFiles = snapshotFiles(
      path.join(destination, "skills", "imported-project"),
    );
    const expectedFiles = new Map(
      [...sourceBefore].map(([name, value]) => [
        name === "Skill.md" ? "SKILL.md" : name,
        value,
      ]),
    );
    assertSnapshotsEqual(expectedFiles, importedFiles);
    assertSnapshotsEqual(sourceBefore, snapshotFiles(source));
    assertSnapshotsEqual(templateBefore, snapshotProjectFiles(template));
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(destination, "package.json"), "utf8"),
    );
    assert.equal(packageJson.name, "imported-project");
    assert.doesNotMatch(result.errors.join("\n"), /skillsmithy-template/);
  });
});

test("import alias and mint --from share the external project command shape", () => {
  withTempDir((directory) => {
    const template = path.join(directory, "template");
    const source = path.join(directory, "SKILL.md");
    const destination = path.join(directory, "preview-project");
    writeTemplateProject(template);
    fs.writeFileSync(
      source,
      "---\n" +
        "name: preview-project\n" +
        "description: Preview an external imported project without writing it.\n" +
        "---\n\n" +
        "Preserve this skill.\n",
    );
    const sourceBefore = fs.readFileSync(source);
    const templateBefore = snapshotProjectFiles(template);

    assert.deepEqual(
      parseImportArguments([
        source,
        "--out-dir",
        destination,
        "--dry-run",
      ]),
      {
        input: source,
        outDir: destination,
        dryRun: true,
      },
    );
    assert.deepEqual(
      parseMintArguments([
        "--from",
        source,
        "--out-dir",
        destination,
        "--dry-run",
      ]),
      {
        name: null,
        from: source,
        outDir: destination,
        dryRun: true,
      },
    );

    const result = mintImportedProject(template, source, destination, {
      dryRun: true,
    });
    assert.equal(result.imported, false);
    assert.equal(result.name, "preview-project");
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readFileSync(source), sourceBefore);
    assertSnapshotsEqual(templateBefore, snapshotProjectFiles(template));
  });
});

test("external import rejects a destination that overlaps its source", () => {
  withTempDir((directory) => {
    const template = path.join(directory, "template");
    const source = path.join(directory, "existing-skill");
    const destination = path.join(source, "generated-project");
    writeTemplateProject(template);
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\n" +
        "name: overlap-skill\n" +
        "description: Reject project output nested inside the imported source.\n" +
        "---\n\n" +
        "Preserve this source tree.\n",
    );
    const sourceBefore = snapshotFiles(source);

    assert.throws(
      () =>
        mintImportedProject(template, source, destination, {
          dryRun: true,
        }),
      /Import destination must not.*inside the supplied skill source/,
    );
    assertSnapshotsEqual(sourceBefore, snapshotFiles(source));
    assert.equal(fs.existsSync(destination), false);
  });
});

test("destination validation rejects inherited template package identity", () => {
  withTempDir((directory) => {
    writeProject(directory, ["alpha"]);
    writePackageFiles(directory, "skillsmithy-template");

    const errors = validateProject(directory).errors.join("\n");
    assert.match(errors, /package\.json: package name "skillsmithy-template"/);
    assert.match(errors, /package-lock\.json: package name "skillsmithy-template"/);
    assert.match(errors, /packages\[""\]\.name "skillsmithy-template"/);
  });
});

test("file import preserves SKILL.md bytes and does not add skill-local files", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "existing", "skill.md");
    writeTemplateProject(project);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    const original = Buffer.from(
      "\uFEFF---\r\n" +
        "name: imported-skill\r\n" +
        "description: Preserve this existing skill exactly during import.\r\n" +
        "---\r\n\r\n" +
        "# Existing formatting\r\n\r\n" +
        "  Keep trailing spaces.  \r\n",
      "utf8",
    );
    fs.writeFileSync(source, original);

    const result = importSkill(project, source);
    const destination = path.join(
      project,
      "skills",
      "imported-skill",
      "SKILL.md",
    );

    assert.equal(result.imported, true);
    assert.deepEqual(fs.readFileSync(source), original);
    assert.deepEqual(fs.readFileSync(destination), original);
    assert.deepEqual(
      fs.readdirSync(path.dirname(destination)).sort(),
      ["SKILL.md"],
    );
    assert.equal(
      fs.existsSync(path.join(project, "skills", "example-skill")),
      false,
    );
    const config = JSON.parse(
      fs.readFileSync(path.join(project, "skill.config.json"), "utf8"),
    );
    assert.equal(config.template, false);
    assert.equal(config.pluginName, "imported-skill");
    assert.match(config.$comment, /preserved byte-for-byte/);
  });
});

test("directory import preserves every supplied file and executable mode", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "existing-skill");
    writeTemplateProject(project);
    fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(source, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "Skill.md"),
      "---\n" +
        "name: preserve-tree\n" +
        "description: Preserve a complete existing skill directory exactly.\n" +
        "---\n\n" +
        "Run scripts/run.sh.\n",
    );
    const script = path.join(source, "scripts", "run.sh");
    fs.writeFileSync(script, "#!/bin/sh\nprintf preserved\n");
    if (process.platform !== "win32") fs.chmodSync(script, 0o751);
    fs.writeFileSync(
      path.join(source, "assets", "binary.dat"),
      Buffer.from([0, 255, 13, 10, 128, 1]),
    );
    const sourceBefore = snapshotFiles(source);

    importSkill(project, source);

    const destination = path.join(project, "skills", "preserve-tree");
    const destinationFiles = snapshotFiles(destination);
    const renamedSource = new Map(
      [...sourceBefore].map(([name, value]) => [
        name === "Skill.md" ? "SKILL.md" : name,
        value,
      ]),
    );
    assertSnapshotsEqual(renamedSource, destinationFiles);
    assertSnapshotsEqual(sourceBefore, snapshotFiles(source));
    assert.equal(
      fs.existsSync(path.join(destination, "agents", "openai.yaml")),
      false,
    );
  });
});

test("directory import hoists project docs and leaves a licence in the skill", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "existing-skill");
    writeTemplateProject(project);
    fs.rmSync(path.join(project, "README.md"));
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\n" +
        "name: documented-skill\n" +
        "description: Separate repository documentation from portable skill content.\n" +
        "---\n\nPerform the documented workflow.\n",
    );
    fs.writeFileSync(path.join(source, "README.md"), "# Documented Skill\n");
    fs.writeFileSync(path.join(source, "CONTRIBUTING.md"), "Send patches.\n");
    fs.writeFileSync(path.join(source, "LICENSE"), "MIT terms.\n");
    fs.writeFileSync(
      path.join(source, "references", "README.md"),
      "Nested docs stay with the skill.\n",
    );
    const sourceBefore = snapshotFiles(source);

    const result = importSkill(project, source);

    const skill = path.join(project, "skills", "documented-skill");
    assert.deepEqual(
      fs.readdirSync(skill).sort(),
      ["LICENSE", "SKILL.md", "references"],
    );
    assert.deepEqual(
      fs.readFileSync(path.join(project, "README.md"), "utf8"),
      "# Documented Skill\n",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(project, "CONTRIBUTING.md"), "utf8"),
      "Send patches.\n",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(skill, "references", "README.md"), "utf8"),
      "Nested docs stay with the skill.\n",
    );
    assertSnapshotsEqual(sourceBefore, snapshotFiles(source));

    const notes = describeProjectDocs(result).join("\n");
    assert.match(notes, /Placed CONTRIBUTING\.md at the project root/);
    assert.match(notes, /Placed README\.md at the project root/);
    assert.match(notes, /Left LICENSE in skills\/documented-skill\//);
  });
});

test("import keeps a supplied README in the skill when the root already has one", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "existing-skill");
    fs.mkdirSync(project, { recursive: true });
    writeProject(project, ["alpha"]);
    fs.writeFileSync(path.join(project, "README.md"), "# Existing product\n");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\n" +
        "name: second-skill\n" +
        "description: Keep supplied documentation when the root name is taken.\n" +
        "---\n\nPerform the second workflow.\n",
    );
    fs.writeFileSync(path.join(source, "README.md"), "# Second skill\n");

    const result = importSkill(project, source, { bundleName: "acme-bundle" });

    assert.equal(
      fs.readFileSync(path.join(project, "README.md"), "utf8"),
      "# Existing product\n",
    );
    assert.equal(
      fs.readFileSync(
        path.join(project, "skills", "second-skill", "README.md"),
        "utf8",
      ),
      "# Second skill\n",
    );
    assert.match(
      describeProjectDocs(result).join("\n"),
      /Kept README\.md in skills\/second-skill\/ because the project root already has README\.md/,
    );
  });
});

test("mint --from places imported project docs at the destination root", () => {
  withTempDir((directory) => {
    const template = path.join(directory, "template");
    const source = path.join(directory, "existing-skill");
    const destination = path.join(directory, "imported-project");
    writeTemplateProject(template);
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\n" +
        "name: hoisting-skill\n" +
        "description: Place supplied repository documentation at the project root.\n" +
        "---\n\nPerform the hoisting workflow.\n",
    );
    fs.writeFileSync(path.join(source, "README.md"), "# Hoisting Skill\n");
    const templateBefore = snapshotProjectFiles(template);

    const preview = mintImportedProject(template, source, destination, {
      dryRun: true,
    });
    assert.match(
      describeProjectDocs(preview).join("\n"),
      /Would place README\.md at the project root instead of skills\/hoisting-skill\//,
    );
    assert.equal(fs.existsSync(destination), false);

    const result = mintImportedProject(template, source, destination);

    assert.equal(
      fs.readFileSync(path.join(destination, "README.md"), "utf8"),
      "# Hoisting Skill\n",
    );
    assert.equal(
      fs.existsSync(
        path.join(destination, "skills", "hoisting-skill", "README.md"),
      ),
      false,
    );
    // The generated discovery trees carry the skill payload only.
    assert.equal(
      fs.existsSync(
        path.join(destination, ".claude", "skills", "hoisting-skill", "README.md"),
      ),
      false,
    );
    assert.match(
      describeProjectDocs(result).join("\n"),
      /Placed README\.md at the project root/,
    );
    assertSnapshotsEqual(templateBefore, snapshotProjectFiles(template));
  });
});

test("dry-run validates the plan without changing source or project", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "skill.md");
    writeTemplateProject(project);
    fs.writeFileSync(
      source,
      "---\nname: preview-skill\n" +
        "description: Preview an existing skill import without writing anything.\n" +
        "---\n\nPreserve it.\n",
    );
    const projectBefore = snapshotFiles(project);
    const sourceBefore = fs.readFileSync(source);

    const result = importSkill(project, source, { dryRun: true });

    assert.equal(result.imported, false);
    assert.equal(result.name, "preview-skill");
    assertSnapshotsEqual(projectBefore, snapshotFiles(project));
    assert.deepEqual(fs.readFileSync(source), sourceBefore);
  });
});

test("invalid imported name is rejected without rewriting it", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "SKILL.md");
    writeTemplateProject(project);
    fs.writeFileSync(
      source,
      "---\nname: Needs Normalizing\n" +
        "description: This name is deliberately not canonical.\n" +
        "---\n\nDo not edit this file.\n",
    );
    const projectBefore = snapshotFiles(project);
    const sourceBefore = fs.readFileSync(source);

    assert.throws(
      () => importSkill(project, source),
      /importer will not rewrite it/,
    );
    assertSnapshotsEqual(projectBefore, snapshotFiles(project));
    assert.deepEqual(fs.readFileSync(source), sourceBefore);
  });
});

test("directory import rejects a source that contains the repository", () => {
  withTempDir((directory) => {
    const source = path.join(directory, "outer-skill");
    const project = path.join(source, "skillsmithy");
    fs.mkdirSync(source);
    writeTemplateProject(project);
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\nname: outer-skill\n" +
        "description: Reject a source that contains the destination repository.\n" +
        "---\n\nDo not recursively stage this tree.\n",
    );
    const sourceBefore = snapshotFiles(source);

    assert.throws(
      () => importSkill(project, source),
      /must not contain the Skill Smithy repository/,
    );
    assertSnapshotsEqual(sourceBefore, snapshotFiles(source));
  });
});

test("add-skill --from owns in-project imports and requires bundle intent", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    const source = path.join(directory, "SKILL.md");
    fs.mkdirSync(project);
    writeProject(project, ["alpha"]);
    fs.writeFileSync(
      source,
      "---\nname: beta\n" +
        "description: Import beta only as part of an intentional cohesive bundle.\n" +
        "---\n\nPerform beta tasks.\n",
    );

    assert.throws(
      () => addSkillToProject(project, { from: source }),
      /pass --bundle <plugin-name>/,
    );
    const result = addSkillToProject(project, {
      from: source,
      bundleName: "alpha-suite",
    });

    assert.equal(result.mode, "bundle");
    assert.equal(
      fs.readFileSync(
        path.join(project, "skills", "beta", "SKILL.md"),
        "utf8",
      ),
      fs.readFileSync(source, "utf8"),
    );
    const config = JSON.parse(
      fs.readFileSync(path.join(project, "skill.config.json"), "utf8"),
    );
    assert.equal(config.mode, "bundle");
    assert.equal(config.pluginName, "alpha-suite");
  });
});

test("add-skill is unavailable in the pristine Skill Smithy checkout", () => {
  withTempDir((directory) => {
    const project = path.join(directory, "project");
    writeTemplateProject(project);

    assert.throws(
      () => addSkillToProject(project, { name: "alpha" }),
      /previously created by mint or import/,
    );
    assert.deepEqual(
      parseAddSkillArguments([
        "--from",
        "../beta",
        "--bundle",
        "alpha-suite",
        "--dry-run",
      ]),
      {
        name: null,
        from: "../beta",
        bundleName: "alpha-suite",
        dryRun: true,
      },
    );
  });
});

function writeProject(root, skillNames) {
  const config = {
    template: false,
    mode: "single",
    pluginName: skillNames[0],
    displayName: "Alpha Skill",
    shortDescription: "Perform the alpha workflow reliably",
    description: "Perform the alpha workflow for supported user requests.",
    defaultPrompt: `Use $${skillNames[0]} to perform a realistic alpha task.`,
    category: "Productivity",
    marketplaceName: "acme-skills",
    marketplaceDisplayName: "Acme Skills",
    marketplaceDescription: "Portable skills maintained by Acme.",
    version: "1.0.0",
    license: "MIT",
    owner: {
      name: "Acme",
      email: "skills@example.org",
      url: "https://github.com/acme",
    },
    repo: "acme/alpha",
    sourceDir: "skills",
    clawhub: {
      githubActions: "off",
      publishBranch: "main",
    },
    targets: {
      claude: true,
      codex: true,
      openclaw: true,
      hermes: true,
    },
  };
  fs.writeFileSync(
    path.join(root, "skill.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  // A finished destination carries the licence its config names, so the
  // fixture does too; the missing-licence warning has its own test.
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT License\n");
  for (const name of skillNames) writeSkill(root, name);
}

function updateConfig(root, mutate) {
  const configPath = path.join(root, "skill.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  mutate(config);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function readPluginManifests(root) {
  return [
    path.join(root, ".claude-plugin", "plugin.json"),
    path.join(root, ".codex-plugin", "plugin.json"),
  ].map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function writeSkill(root, name) {
  const skillRoot = path.join(root, "skills", name);
  fs.mkdirSync(path.join(skillRoot, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    `---\n` +
      `name: ${name}\n` +
      `description: Perform the ${name} workflow for realistic requests.\n` +
      `metadata:\n` +
      `  openclaw:\n` +
      `    requires:\n` +
      `      bins: [git]\n` +
      `---\n\n` +
      `Perform the ${name} workflow and report the result.\n`,
  );
  fs.writeFileSync(
    path.join(skillRoot, "agents", "openai.yaml"),
    `interface:\n` +
      `  display_name: "${name}"\n` +
      `  short_description: "Perform the ${name} workflow reliably"\n` +
      `  default_prompt: "Use $${name} to perform a realistic task."\n`,
  );
}

const DESTINATION_IGNORE_FIXTURE =
  "node_modules/\n" +
  ".claude/settings.local.json\n" +
  "\n" +
  "# Interrupted runs can leave these behind.\n" +
  ".skillsmithy-stage-*\n" +
  ".skillsmithy-transaction-*\n" +
  ".skillsmithy-import-*\n" +
  "\n" +
  "# Generated discovery copies; `npm run build` recreates them.\n" +
  ".claude/skills/\n" +
  ".agents/skills/\n";

function writeTemplateProject(root) {
  fs.mkdirSync(path.join(root, "skills", "example-skill"), {
    recursive: true,
  });
  const config = templateConfig();
  fs.writeFileSync(
    path.join(root, "skill.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, "skills", "example-skill", "SKILL.md"),
    "---\n" +
      "name: example-skill\n" +
      "description: Template example used only before initialization.\n" +
      "---\n\nReplace this example.\n",
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Skill Smithy playbook\n");
  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "templates", "AGENTS.destination.md"),
    "# Authoring contract\n",
  );
  fs.writeFileSync(
    path.join(root, "templates", ".gitignore.destination"),
    DESTINATION_IGNORE_FIXTURE,
  );
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  fs.writeFileSync(path.join(root, "README.md"), "# Skill Smithy\n");
  writePackageFiles(root, "skillsmithy-template");
}

function templateConfig() {
  return {
    template: true,
    mode: "single",
    pluginName: "example-skill",
    displayName: "Example Skill",
    shortDescription: "Template for one polished agent skill",
    description: "Template plugin for portable Agent Skill projects.",
    defaultPrompt: "Use $example-skill to demonstrate the template workflow.",
    category: "Productivity",
    marketplaceName: "my-skills",
    marketplaceDisplayName: "My Skills",
    marketplaceDescription: "Portable Agent Skills from one canonical source.",
    version: "0.1.0",
    license: "MIT",
    owner: {
      name: "Your Name",
      email: "you@example.com",
      url: "https://github.com/your-handle",
    },
    repo: "your-handle/your-repo",
    sourceDir: "skills",
    clawhub: {
      githubActions: "off",
      publishBranch: "main",
    },
    targets: {
      claude: true,
      codex: true,
      openclaw: true,
      hermes: true,
    },
  };
}

function bumpPackageVersion(root, version) {
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  packageJson.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function writePackageFiles(root, name) {
  const packageJson = {
    name,
    private: true,
    description: "Template tooling fixture.",
    version: "1.0.0",
    type: "module",
    license: "MIT",
    scripts: {
      mint: "node scripts/mint.mjs",
      import: "node scripts/import.mjs",
      "add-skill": "node scripts/add-skill.mjs",
      build: "node scripts/build.mjs",
      validate: "node scripts/validate.mjs",
      doctor: "node scripts/doctor.mjs",
      check: "node scripts/check.mjs",
      test: "node --test tests/*.test.mjs",
    },
    dependencies: {
      yaml: "^2.9.0",
    },
  };
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  const packageLock = {
    name,
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name,
        version: "1.0.0",
        license: "MIT",
        dependencies: {
          yaml: "^2.9.0",
        },
      },
    },
  };
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    `${JSON.stringify(packageLock, null, 2)}\n`,
  );
}

function snapshotFiles(root) {
  const snapshot = new Map();
  const visit = (current, relativePath) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const name = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, name);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        snapshot.set(name, {
          contents: fs.readFileSync(absolute),
          mode: process.platform === "win32" ? 0 : stat.mode & 0o777,
        });
      }
    }
  };
  visit(root, "");
  return snapshot;
}

function snapshotProjectFiles(root) {
  const snapshot = new Map();
  const ignoredRootNames = new Set([".git", "node_modules"]);
  const visit = (current, relativePath) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (relativePath === "" && ignoredRootNames.has(entry.name)) continue;
      if (
        relativePath === "" &&
        entry.name.startsWith(".skillsmithy-")
      ) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      const name = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, name);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        snapshot.set(name, {
          contents: fs.readFileSync(absolute),
          mode: process.platform === "win32" ? 0 : stat.mode & 0o777,
        });
      }
    }
  };
  visit(root, "");
  return snapshot;
}

function assertSnapshotsEqual(left, right) {
  assert.deepEqual([...left.keys()].sort(), [...right.keys()].sort());
  for (const key of left.keys()) {
    assert.deepEqual(left.get(key).contents, right.get(key).contents, key);
    assert.equal(left.get(key).mode, right.get(key).mode, key);
  }
}

function withTempDir(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skillsmithy-test-"));
  try {
    callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
