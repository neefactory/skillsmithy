# Skill Smithy playbook

This is the canonical instruction file for every agent working in the Skill
Forge checkout. `CLAUDE.md` exists only to import it, because Claude Code reads
`CLAUDE.md` rather than `AGENTS.md`. Record project instructions here, not
there.

Read `skill.config.json` before acting:

- `template: true` means this checkout is a reusable project source. Never
  author or import a canonical skill here. Create an external destination with
  `mint` or `import`, then continue there.
- `template: false` means you are not in a Skill Smithy checkout at all but in a
  destination project, whose own root `AGENTS.md` is the contract to follow.

## The authoring contract

This file covers only the interview, mint, and import that produce a
destination. Everything about authoring a skill — publisher identity, licensing,
the workflow, bundle rules, validation commands, and completion criteria — lives
in `templates/AGENTS.destination.md`, which is copied into every destination as
its root `AGENTS.md`.

Read `templates/AGENTS.destination.md` in full before the interview. Three of
its sections describe questions to settle before minting: publisher identity is
never inherited, the licence has three shapes the user chooses between, and
discovery keywords are proposed by you rather than asked for cold.

@templates/AGENTS.destination.md

Edits to authoring rules belong in `templates/AGENTS.destination.md` so that
destinations receive them. Keep this file to what only a Skill Smithy checkout
does.

## Starting points

Expect terse requests. Expand them into the full workflow yourself rather than
asking the user to restate it:

- "Mint a new skill", "Create a skill", or similar: run the required workflow
  below from step 1, beginning with the interview.
- "Import my skill at `<path>`" or similar: run the existing-skill import
  workflow.

Skill Smithy is often a subfolder of the folder the user opened, as in
`<project-folder>/skillsmithy/`, so that minted projects stay inside the same
workspace. Recognize a request naming that subfolder, such as "Mint a new skill
using ./skillsmithy", as the same workflow. In that arrangement, run the
commands from the Skill Smithy subfolder and mint into a sibling of it
(`--out-dir ../<skill-name>`, resolving inside the opened project folder) rather
than to a path outside the workspace. Confirm the destination with the user
during the interview if the layout is unclear.

The user is not expected to name the interview, the commands, the validation
targets, or the completion criteria. This file is the contract; follow it in
full even when the request is a single sentence.

## Required workflow

1. Determine whether the user is authoring a new skill, importing an existing
   one, or developing Skill Smithy itself. Never edit imported skill content
   unless the user separately and explicitly asks for edits.
2. For a new skill, interview the user before minting. Establish:
   - two or three realistic requests that should use the skill;
   - situations that must not trigger it;
   - expected outputs and important edge cases;
   - required tools, credentials, references, and assets;
   - GitHub owner/repository and publisher metadata, asked directly and never
     guessed from this checkout, `git config`, or the environment;
   - whether ClawHub is a destination and, if so, whether publishing will use
     the CLI, one-time web GitHub import, manually dispatched GitHub Actions,
     or automatic publishing from pushes; ask separately for any ClawHub
     publisher handle and never infer it from the GitHub owner;
   - the licence, offering the three shapes from
     `templates/AGENTS.destination.md` with MIT-0 throughout as the default;
   - optional discovery keywords, which unlike publisher identity you propose
     from the skill's own purpose for the user to confirm or decline;
   - an empty destination directory for the independent project.
3. For a new skill, run
   `npm run mint -- <skill-name> --out-dir <destination>` yourself once the
   interview is settled; do not ask the user to run it. For an existing skill,
   follow the import workflow below. Never manually copy the example skill or
   replace its `SKILL.md`.
4. Use a lowercase, hyphenated, action-oriented skill name no longer than 64
   characters.
5. After mint or import succeeds, switch the working directory to the
   destination, run `npm install` to install its exact Skill Smithy development
   dependency and create `package-lock.json`, then perform all authoring,
   metadata, evaluation, build, and validation work there, following that
   project's root `AGENTS.md`. The Skill Smithy checkout must remain unchanged.

## Existing-skill import

From the pristine Skill Smithy checkout, run a non-mutating preview and then
create a separate destination:

```bash
npm run import -- <source> --out-dir <destination> --dry-run
npm run import -- <source> --out-dir <destination>
```

Import is strictly byte-preserving. Do not normalize frontmatter, reformat
Markdown, generate files inside the skill, fix validation findings, or alter
supporting resources as part of import. The source must remain untouched and
every imported file must arrive with the same bytes; only a case-insensitive
source filename such as `skill.md` is mapped to canonical `SKILL.md`. Record
packaging metadata in `skill.config.json` and report validation findings
separately.

Placement is the one packaging decision import makes. A root-level `README.md`,
`CONTRIBUTING.md`, or `CHANGELOG.md` documents the repository rather than the
skill, so import writes it to the project root instead of `skills/<skill-name>/`,
keeping it out of the generated discovery copies that ship with the skill.
Contents are unchanged, and the placement is reported in both normal and
`--dry-run` output. A root-level `LICENSE` is left inside the skill and only
reported, because a licence beside `SKILL.md` is usually there so its terms
travel with the distributed skill — the same placement the split licence shape
uses. When the project root already holds a file of that name, import keeps the
supplied copy in the skill directory and says so; relocating it is then the
author's call. Documents nested under `references/` or `assets/` are skill
content and are never reclassified.

Pass a directory when the existing skill has scripts, references, assets, or
other resources. Passing a file intentionally imports only that file.

## Developing Skill Smithy itself

`npm test` in this checkout runs unit tests, packs the current working tree as
an npm tarball, exercises mint and migration through that installed artifact,
then runs validation and drift detection. Do not replace the tarball acceptance
path with a source-directory copy: `npm pack` is what verifies the published
file allowlist, CLI binary, dependencies, and installed path resolution.

`mint` and `import` are template/package commands. A destination declares the
exact `@neefactory/skillsmithy` release as a development dependency and exposes
the commands it can run through npm scripts: `add-skill`, `build`, `validate`,
`check`, `doctor`, and `migrate`. It never receives copied Forge scripts.

Mint and import also write `.skillsmithy/provenance.json` and managed-file
baselines. Migrations must preserve canonical `skills/**` bytes, preview without
writing under `npm run migrate -- --dry-run`, refuse overlapping local and
upstream edits to managed files, and rebuild generated adapters only on apply.
A migration refreshes only what it manages — `name`, `version`, the Skill Smithy
npm scripts, and the tooling dependency. Everything else in a destination's
`package.json`, including its `test` script, is seeded when absent and never
rewritten.

A destination's `.gitignore` comes from `templates/.gitignore.destination`, not
from this checkout's own `.gitignore`. npm renames a packaged `.gitignore` to
`.npmignore` on install, so a copied file would silently vanish from published
releases and leave destinations committing their own `node_modules`. Keep the
two files separate, and keep `templates/.gitignore.destination` in
`package.json`'s `files` allowlist.

Project commands resolve their target from the CLI, which exports
`SKILL_SMITHY_PROJECT_ROOT` for project commands and `SKILL_SMITHY_TEMPLATE_ROOT`
for `mint` and `import`. A script reached without the CLI sets neither and is
refused rather than treating the installed package as a project.

When changing package-delivered tooling, schemas, or the destination contract,
keep `package.json`'s version, the release tag, and the npm package release
aligned. The release workflow must pass the packed-package acceptance test
before publishing `@neefactory/skillsmithy`.

Both instruction files reach a destination: `templates/AGENTS.destination.md` is
installed as its root `AGENTS.md`, and this checkout's one-line `CLAUDE.md` is
copied verbatim so Claude Code loads it. This checkout's own `AGENTS.md` is
never copied.
