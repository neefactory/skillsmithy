import fs from "node:fs";
import path from "node:path";
import {
  NAME_PATTERN,
  listSkillNames,
  loadConfig,
  toDisplayName,
  writeJson,
} from "./lib.mjs";

export function initializeProject(
  root,
  { name, add = false, bundleName = null } = {},
) {
  assertName(name, "skill name");
  if (bundleName) assertName(bundleName, "bundle plugin name");

  const config = loadConfig(root);
  const sourceRoot = path.join(root, config.sourceDir);
  const destination = path.join(sourceRoot, name);

  if (fs.existsSync(destination)) {
    throw new Error(`Skill "${name}" already exists.`);
  }

  if (add) {
    addBundleSkill(config, destination, {
      name,
      bundleName,
    });
  } else {
    initializeTemplate(root, sourceRoot, config, destination, { name });
  }

  writeJson(path.join(root, "skill.config.json"), config);
  return { config, destination };
}

function initializeTemplate(
  root,
  sourceRoot,
  config,
  destination,
  { name },
) {
  if (!config.template) {
    throw new Error(
      "This repository is already initialized. Template initialization is internal; " +
        "use `npm run add-skill` only for a cohesive multi-skill plugin.",
    );
  }
  const names = listSkillNames(root, config.sourceDir);
  if (names.length !== 1 || names[0] !== "example-skill") {
    throw new Error("Template initialization expects only skills/example-skill.");
  }

  const example = path.join(sourceRoot, "example-skill");
  fs.renameSync(example, destination);
  cleanExampleResources(destination);
  writeSkillSkeleton(destination, name);

  const displayName = toDisplayName(name);
  config.$comment =
    "Author canonical content under skills/. Use mode=bundle only when every skill should be installed and versioned together. Set clawhub.githubActions to manual or push only after confirming that publishing route and owner.";
  config.template = false;
  config.mode = "single";
  config.pluginName = name;
  config.displayName = displayName;
  config.shortDescription = "TODO: Add a 25-64 character skill summary";
  config.description =
    "TODO: Describe what this plugin does and when users should install it.";
  config.defaultPrompt = `Use $${name} to TODO: describe a realistic task.`;
  config.marketplaceName = name;
  config.marketplaceDisplayName = displayName;
  config.marketplaceDescription =
    "TODO: Describe this skill marketplace for prospective users.";
}

function addBundleSkill(config, destination, { name, bundleName }) {
  if (config.template) {
    throw new Error(
      "add-skill must run inside a project previously created by mint or import.",
    );
  }

  if (config.mode === "single") {
    if (!bundleName) {
      throw new Error(
        "Adding a second skill is intentional: pass `--bundle <plugin-name>` " +
          "to confirm both skills should be installed and versioned together.",
      );
    }
    config.mode = "bundle";
    config.pluginName = bundleName;
    config.displayName = toDisplayName(bundleName);
    config.marketplaceName = bundleName;
    config.marketplaceDisplayName = toDisplayName(bundleName);
  } else if (bundleName && bundleName !== config.pluginName) {
    throw new Error(
      `This bundle is already named "${config.pluginName}"; ` +
        `received "${bundleName}".`,
    );
  }

  fs.mkdirSync(destination, { recursive: true });
  writeSkillSkeleton(destination, name);
}

function writeSkillSkeleton(directory, name) {
  const displayName = toDisplayName(name);
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\n` +
      `name: ${name}\n` +
      `description: "TODO: Explain what this skill does, when to use it, and when not to use it."\n` +
      `---\n\n` +
      `# ${displayName}\n\n` +
      `TODO: Write concise, imperative instructions for the agent.\n`,
  );

  const agentsDir = path.join(directory, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, "openai.yaml"),
    `interface:\n` +
      `  display_name: ${JSON.stringify(displayName)}\n` +
      `  short_description: "TODO: Add a 25-64 character skill summary"\n` +
      `  default_prompt: ${JSON.stringify(
        `Use $${name} to TODO: describe a realistic task.`,
      )}\n`,
  );
}

function cleanExampleResources(directory) {
  for (const name of ["scripts", "references", "assets", "agents"]) {
    fs.rmSync(path.join(directory, name), { recursive: true, force: true });
  }
}

function assertName(value, label) {
  if (
    typeof value !== "string" ||
    !NAME_PATTERN.test(value) ||
    value.length > 64
  ) {
    throw new Error(
      `${label} must be 1-64 lowercase letters, numbers, or single hyphens.`,
    );
  }
}
