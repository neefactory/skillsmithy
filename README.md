
<div align="center">

<img src="assets/logo.webp" width="320" alt="Skill Smithy. スキルスミシー">

# Skill Smithy

**スキルスミシー<br />Sukiru Sumishī**

[![ci](https://github.com/neefactory/skillsmithy/actions/workflows/ci.yml/badge.svg)](https://github.com/neefactory/skillsmithy/actions/workflows/ci.yml)
[![latest release](https://img.shields.io/github/v/release/neefactory/skillsmithy?sort=semver)](https://github.com/neefactory/skillsmithy/releases/latest)
[![downloads](https://img.shields.io/github/downloads/neefactory/skillsmithy/total)](https://github.com/neefactory/skillsmithy/releases)
[![license](https://img.shields.io/github/license/neefactory/skillsmithy)](LICENSE)
[![minted projects](https://img.shields.io/badge/minted%20projects-MIT--0%20default-blue)](#licensing)

[![node](https://img.shields.io/badge/node-%E2%89%A5%2022.8-brightgreen)](https://nodejs.org)
![platforms](https://img.shields.io/badge/tested%20on-windows%20%7C%20ubuntu-blue)
[![signed provenance](https://img.shields.io/badge/release-signed%20provenance-informational)](#get-skillsmithy)
[![Agent Skills](https://img.shields.io/badge/spec-Agent%20Skills-8A2BE2)](https://agentskills.io)

</div>

An agent-first project generator for creating polished, publishable
[Agent Skills](https://agentskills.io) and packaging them for Claude Code,
Codex, OpenClaw, and Hermes Agent from one canonical source.

**There are two agent driven paths:**

- **New skill**: The agent interviews you, mints an independent project,
  authors one canonical skill, and lets the deterministic tooling validate and
  package it.
- **Existing skill**: The agent previews the import, creates an independent
  project, preserves your skill byte for byte, and validates and packages it.

Either way the Skill Smithy checkout stays pristine and reusable. Each
destination is an independent project with its own source, generated adapters,
documentation, and publishing metadata. Its validation and generation commands
come from an exact `@neefactory/skillsmithy` development dependency rather than
copied Forge scripts.

## Get Skill Smithy

Download `skillsmithy.zip` from the [latest release][releases] and unzip it. You
never need to clone, so there is no upstream checkout sitting around waiting to
receive an accidental commit or pull request.

The archive is built by CI from the tagged commit with `git archive`, so it
contains exactly the tracked files at that tag and nothing else. Verify it with:

```bash
gh attestation verify skillsmithy.zip --repo neefactory/skillsmithy
```

That checks a signed provenance attestation proving which workflow, repository,
and commit produced the file. If you would rather rebuild it and compare hashes,
clone the repository and run the same command CI runs:

```bash
git archive --format=zip --prefix=skillsmithy/ -o check.zip v1.0.0
```

`git archive` output is stable in practice but not formally guaranteed across
git versions, so a hash mismatch between different git versions is expected
rather than alarming.

Cloning still works fine if you prefer it. Either way, install dependencies once:

```bash
npm ci
```

The npm package exposes the same entry point. After a release has been
published, it can mint without a separate checkout:

```bash
npm exec --package=@neefactory/skillsmithy@1.0.0 -- \
  skillsmithy mint my-new-skill --out-dir ../my-new-skill
```

Released archives, Git tags, and npm packages use the same version.

## Mint a skill

### With an agent

Agents are usually confined to the folder you open them in, and a minted project
is always created *outside* the Skill Smithy folder — `mint` refuses any
destination that overlaps its own checkout. So put Skill Smithy inside the project
folder you open, and let the destination land beside it:

```text
my-skills\                 <- open this folder with your agent
├─ skillsmithy\            <- the unzipped release
└─ my-new-skill\          <- your minted project, created here
```

Everything then happens inside one workspace, with no permission prompts to
approve writes elsewhere. Ask for what you want:

```text
Please mint a new skill using ./skillsmithy.
```

That is the whole prompt. The agent reads `skillsmithy/AGENTS.md`, interviews you
about the requests that should and should not trigger the skill, the tools and
credentials it needs, its expected outputs and edge cases, and whether ClawHub
publishing should use the CLI, web import, manual Actions, or automatic pushes.
It then runs `mint` itself, moves into the new sibling project, and authors,
tests, and validates the skill there.

Name the folder in that first prompt, because agents load their instruction files
from the folder you open rather than from its subfolders. Later sessions can open
the minted project directly, where its own `CLAUDE.md` loads on its own.

### From a terminal

No workspace boundary applies, so mint wherever you like, then open that
directory with an agent:

```bash
npm run mint -- my-new-skill --out-dir ../my-new-skill
```

### What mint does

`mint`:

- requires a pristine template checkout;
- refuses a destination that is nonempty, a symlink, or overlaps the checkout;
- copies an explicit allow list, so local agent settings, credentials, editor
  state, `.git`, `node_modules`, and anything else untracked stay behind;
- writes an exact `@neefactory/skillsmithy` development dependency instead of
  copying the implementation into the destination;
- writes the destination's `.gitignore` from `templates/.gitignore.destination`,
  so an installed project ignores `node_modules/`, local agent settings, and the
  generated discovery copies;
- records managed-file baselines under `.skillsmithy/` for future migrations;
- initializes the named canonical skill in the destination;
- resets `owner`, `repo`, and `license` so no publisher identity from this
  checkout, or from a fork of it, reaches the destination;
- generates discovery copies for the destination so no `example-skill`
  artifacts remain;
- leaves the Skill Smithy checkout unchanged.

A destination is a distinct product, so mint deliberately creates no
`README.md`, copies no `LICENSE` or tests, and starts ClawHub GitHub Actions
publishing in the `"off"` state. Write the product page, add a licence, and
choose CI to taste. If the user opts into ClawHub Actions, `npm run build`
generates the one managed workflow at
`.github/workflows/clawhub-publish.yml`; other `.github/` files remain
user-owned. The agent is instructed to ask which licence you want and to
default to MIT-0, as described under [Licensing](#licensing). Publisher
metadata is reset rather than copied: `owner` and `repo` arrive as placeholders,
any `owner.email` and ClawHub publisher handle are dropped, and `license` is set
to `MIT-0`, so your name and handle can only reach a destination by answering
the agent's questions. The destination's npm version starts at
`skill.config.json`'s `version` rather than inheriting Skill Smithy's release
number. The separate development-dependency version records which Skill Smithy
tooling release supplies the project commands.

Every destination carries its own instruction files: a root `AGENTS.md` holding
the authoring contract, and a one-line `CLAUDE.md` that imports it with
`@AGENTS.md` so Claude Code loads it. That `AGENTS.md` is the destination
contract rather than a copy of Skill Smithy's own playbook, so an agent opened
directly in the project is never told to run `mint` or `import`. See
[Agent instruction files](#agent-instruction-files).

## Import an existing skill without changing it

Same idea, same layout, different starting point. Ask the agent:

```text
Please import the skill at ./my-skill using ./skillsmithy.
```

Or run it yourself from the pristine checkout, passing either an existing
`SKILL.md` file or its complete skill directory plus an external destination:

```bash
npm run import -- ./my-skill --out-dir ../my-new-skill --dry-run
npm run import -- ./my-skill --out-dir ../my-new-skill
```

`import` is an alias for `mint --from`; both use the same guarded, transactional
project creation path. It is a preservation operation, not a migration rewrite,
so it:

- creates a complete external project and never authors inside Skill Smithy;
- never writes to the supplied source;
- copies every supplied byte, binary asset, and executable mode unchanged;
- permits `skill.md` in any letter case but names the canonical copy `SKILL.md`;
- derives repository-level packaging metadata without adding to or editing the
  imported skill;
- reports validation findings instead of repairing skill content.

The equivalent canonical command is:

```bash
npm run mint -- --from ./my-skill --out-dir ../my-new-skill
```

Two things to watch. The frontmatter `name` must already be a valid lowercase,
hyphenated skill name, because the importer will not normalize it for you. And a
file import copies only that file — pass the directory to retain scripts,
references, assets, and other supporting files. Once imported, open the
destination with the agent, review publisher metadata in `skill.config.json`,
then run `npm test` and `npm run doctor`.

Importing an *additional* skill happens only from an already-created
destination, and requires explicit cohesive bundle intent:

```bash
cd ../my-skill
npm run add-skill -- --from ../another-skill --bundle my-skill-suite
```

## Deterministic workflow

Underneath the conversation, this is what runs:

```bash
# In the reusable pristine Skill Smithy checkout:
npm ci
npm run mint -- my-new-skill --out-dir ../my-new-skill

# In the minted project:
cd ../my-new-skill
npm install

# Author skills/my-new-skill/, the root README, and skill.config.json.
npm run build
npm test
npm run doctor
```

The first `npm install` creates `package-lock.json`; commit it. Later clean
checkouts should use `npm ci`.

A minted project starts with a minimal skill and `agents/openai.yaml`, and it is
intentionally incomplete until the agent replaces every TODO and publisher
placeholder and writes the product README. Leftover scaffold text is reported as
a warning rather than an error, so judge publishing readiness yourself instead of
treating a green `npm test` as approval.

## Agent instruction files

There are two contracts, because a Skill Smithy checkout and a finished skill
project do different work:

- `AGENTS.md` at this root is Skill Smithy's own playbook: the interview, `mint`,
  and `import`. It is never copied into a destination.
- `templates/AGENTS.destination.md` is the authoring contract — publisher
  identity, licensing, the workflow, bundle rules, validation commands, and
  completion criteria. Mint and import install it as the destination's root
  `AGENTS.md`.

Edit authoring rules in `templates/AGENTS.destination.md` so destinations
receive them; keep this root `AGENTS.md` to what only a checkout does. The rules
are not duplicated between the two files, so a checkout agent is told to read
the destination contract before the interview, and this root `AGENTS.md` also
`@`-imports it for Claude Code.

Claude Code reads `CLAUDE.md` rather than `AGENTS.md`, so the root `CLAUDE.md` is
a one-line `@AGENTS.md` import that expands at session start. It is copied
verbatim into every destination, where it resolves to that project's own
contract.

The import beats a `CLAUDE.md` symlink because symlinks require Administrator
privileges or Developer Mode on Windows. To support an agent that reads some
other filename, add another pointer file the same way rather than duplicating the
contract.

## Product shape

Each destination project contains one installable plugin by default:

```text
README.md                       human-facing product page
package.json                    project identity and exact Forge dependency
package-lock.json               installed dependency lock
skill.config.json               packaging and publisher metadata
.skillsmithy/provenance.json    installed Forge release and managed hashes
.skillsmithy/baseline/          managed-file merge baselines
skills/<name>/SKILL.md         canonical portable skill
skills/<name>/agents/          optional product UI metadata
skills/<name>/scripts/         optional deterministic helpers
skills/<name>/references/      optional on-demand documentation
skills/<name>/assets/          optional output resources
evals/                          suggested home for substantial-skill evals

.claude/skills/                generated Claude project discovery
.agents/skills/                generated Codex project discovery
.claude-plugin/                generated Claude plugin + marketplace
.codex-plugin/                 generated Codex plugin
.agents/plugins/               generated Codex marketplace
.github/workflows/
  clawhub-publish.yml          optional generated ClawHub publisher
```

The pristine Skill Smithy checkout generates the manifests but not the two
discovery directories, because committing them here would register
`example-skill` with every agent opened on the template. Destinations generate
both.

The discovery directories are local conveniences, not distribution. They
register the skill you are authoring with the agent you author it in, so you can
invoke and forward-test it in the project itself. No installer reads them: the
Claude marketplace entry points at `source: "./"`, the Codex plugin declares
`"skills": "./skills/"`, and OpenClaw, ClawHub, and Hermes read
`skills/<name>/`. Everything that ships comes from the canonical directory.

Because nothing reads them, mint gitignores both in the destination:

```text
.claude/skills/
.agents/skills/
```

Committing them would put a second and third `SKILL.md` in the published
repository, and a marketplace importer that scans a repository for skills finds
three where the project has one. The manifests installers do read 
`.claude-plugin/`, `.codex-plugin/`, and `.agents/plugins/marketplace.json`
stay committed. `npm run check` asks git which generated paths the repository
ignores and skips those on both sides, so a fresh clone passes before its first
build while a stale manifest is still reported.

The ignore rules protect new commits; they do not untrack files an older
destination already committed. `npm run validate` asks Git whether either
discovery directory is tracked and fails with remediation guidance when it
finds one. Untrack the generated copies without deleting the local files:

```bash
git rm -r --cached -- .claude/skills .agents/skills
npm run build
```

Commit the index change and updated `.gitignore`. The generated copies remain
available locally and are recreated by every build.

Because Claude never reads `agents/openai.yaml` (it is Codex UI
metadata) the Claude discovery copy omits that one file, and omits an `agents/`
directory it would have left empty. Otherwise every discovery copy mirrors the
canonical skill exactly. The exclusion is the file, not the directory, so a
skill that keeps other content under `agents/` still receives it. Nothing about
the published artifact changes: `skills/<name>/agents/openai.yaml` is canonical,
required by [the destination contract](templates/AGENTS.destination.md), and
copied to the Codex discovery path unchanged.

`evals/` is a naming suggestion only. Nothing scaffolds or validates it, so
create it only when a skill is substantial enough to warrant evaluations.

OpenClaw, ClawHub, and Hermes Agent consume `skills/<name>/` directly. Skill
Forge does not transform or duplicate their vendor-specific frontmatter, and does
not generate a `.hermes/` copy.

For OpenClaw and ClawHub, declare runtime requirements under
`metadata.openclaw`: `requires.env`, `requires.bins`, `requires.anyBins`,
`requires.config`, `primaryEnv`, `envVars`, supported `install` entries, and
other documented runtime fields. Validation checks recognized shapes, warns
when common code patterns reference undeclared environment variables, reports
hidden paths and symlinks that ClawHub will omit, and reports a bundle above
ClawHub's 50 MB server limit. It also rejects unsupported per-skill licence and
pricing frontmatter. These are preflights rather than a replacement for
ClawHub's own dry-run and security analysis.

Hermes-specific metadata is optional. Put `platforms` at the top level of
`SKILL.md` frontmatter, with values drawn from `macos`, `linux`, and `windows`.
Put `tags`, `related_skills`, `requires_toolsets`, `requires_tools`,
`fallback_for_toolsets`, `fallback_for_tools`, `config`, and `blueprint` under
`metadata.hermes`. Hermes has no `category` field, so categorize with `tags`.
Skill Smithy validates recognized Hermes fields when present, leaves unrecognized
ones untouched, and adds none of them to newly minted skill skeletons.

Hermes currently reads `platforms` at the top level, but
[hermes-agent#30080](https://github.com/NousResearch/hermes-agent/issues/30080)
proposes moving `tags` and `platforms` under `metadata` for strict
agentskills.io compliance. Re-check that field if you target Hermes.

Generated paths are replaced transactionally. Parent directories such as
`.claude/` and `.agents/` may contain user-owned settings or plugins, so they are
never deleted wholesale. Before replacement, Skill Smithy checks every generated
path and its writable parent. If an active agent has protected a discovery path
such as `.agents/skills`, request write permission or temporarily unload that
generated skill, then retry.

To validate generation while in-place discovery paths are unavailable, stage the
build elsewhere:

```bash
npm run build -- --out-dir ../skill-build-preview
```

This validates and writes the generated adapters without replacing the active
project paths. Re-run `npm run build` in place once the protected path becomes
writable, so drift checking can pass.

## Cohesive multi-skill plugins

Default to separate repositories when skills can be installed or released
independently. If several skills must always ship together, enter bundle mode
explicitly:

```bash
npm run add-skill -- gh-address-comments --bundle github-maintenance

# Or preserve and add an existing skill:
npm run add-skill -- --from ../gh-address-comments --bundle github-maintenance

# Additional skills once bundle mode is active:
npm run add-skill -- gh-fix-ci
npm run add-skill -- --from ../gh-review-prs
```

In `single` mode, validation requires exactly one skill and requires the plugin
name to match it. In `bundle` mode, all canonical skills are packaged as one
plugin with one version and one marketplace entry.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run mint -- <name> --out-dir <path>` | Create a new project outside Skill Smithy (template only) |
| `npm run import -- <source> --out-dir <path>` | Create a new project from an existing skill (template only) |
| `npm run add-skill -- <name>` | Modify an already-created project with a cohesive skill |
| `npm run add-skill -- --from <source>` | Preserve and add an existing skill to an already-created bundle |
| `npm run build` | Generate discovery copies, marketplace manifests, and optional ClawHub workflow |
| `npm run validate` | Validate config, YAML, metadata, ClawHub preflights, tracked duplicates, licence, manifests, and generated workflows |
| `npm run check` | Byte-check generated output without touching the working tree |
| `npm run migrate -- --dry-run` | Preview a dependency/tooling migration without writing |
| `npm run migrate` | Apply a conflict-free migration and regenerate adapters |
| `npm test` | In Skill Smithy, run unit, packed-package, validation, and drift tests; in a destination, run validation and drift checking |
| `npm run doctor` | Report Git, vendor CLI, and publishing readiness |

`init` is an internal implementation detail, not a public npm command. Never
author inside the Skill Smithy checkout; mint or import a destination, then
continue work there. `mint` and `import` require a pristine template, so they are
not destination npm scripts. A destination invokes the commands it does expose
through its installed Skill Smithy package.

## Updating a minted project

Update the exact development dependency on a branch, preview the migration, and
apply only after reviewing the plan:

```bash
git switch -c chore/update-skillsmithy
npm install --save-dev --save-exact @neefactory/skillsmithy@<version>
npm run migrate -- --dry-run
npm run migrate
npm test
git diff
```

Mint writes `.skillsmithy/provenance.json` plus baseline copies of managed
project files. Migration compares three states: the recorded baseline, the
project's current file, and the newer package's desired file. Unchanged managed
files are replaced, local-only changes are preserved, and overlapping local and
package changes stop as explicit conflicts. Canonical `skills/**` bytes are
never migration targets.

Applying a clean migration refreshes `package.json`, the destination contract
and schema when safe, the provenance baseline, and generated adapters. A project
whose provenance is missing is bootstrapped conservatively: differing managed
files are preserved as local customizations rather than replaced.

Migration is deliberately narrow about `package.json`. It manages `name`,
`version`, the six Skill Smithy npm scripts, and the tooling dependency, and it
seeds `description`, `license`, `engines`, `private`, and `test` only when they
are absent. A project that extends its `test` script with its own evaluations,
adds a `files` list, or publishes itself keeps all of that across upgrades.

Installing a newer package without migrating is a visible state rather than a
silent one: `npm run validate` warns when the exact pin in `package.json`
disagrees with the release recorded in `.skillsmithy/provenance.json`, and
`npm run doctor` reports whether the pinned release is actually installed.

Package installation never mutates the repository through `postinstall`.
Migration is always an explicit command, and `--dry-run` writes nothing.

## Publishing and installation

Push the complete destination project to GitHub, excluding local dependencies and
temporary files such as `node_modules`. Plugin manifests point installers to
`skills/`, so root npm commands, tests, configuration, and authoring guidance do
not become runtime skill instructions.

- Claude Code: `claude plugin marketplace add <owner>/<repo>`, then install the
  single plugin shown by the marketplace.
- Codex: `codex plugin marketplace add <owner>/<repo>`, then install the plugin
  from the Plugins directory.
- OpenClaw/ClawHub: use web GitHub import, the CLI, or the optional generated
  GitHub Actions workflow described below.
- Hermes Agent: install a skill from any public GitHub repository with
  `hermes skills install <owner>/<repo>/skills/<skill-name>`. Adding the
  repository as a tap with `hermes skills tap add <owner>/<repo>` makes it
  discoverable through `hermes skills search`; the install path is the same
  either way, because `skills/` is the tap's default subtree rather than part of
  the command.
- Plain Agent Skills clients can consume or copy the canonical `skills/<name>/`
  directory.

### Publish to ClawHub

ClawHub has three useful skill-publishing routes. All publish the canonical
folders under `skills/`; none publishes `.claude/skills/` or `.agents/skills/`.

**Web GitHub import** is convenient for the first release. ClawHub searches
public, non-fork, non-archived, non-disabled repositories owned by the signed-in
GitHub account and discovers their tracked `SKILL.md` files. Import creates a
ClawHub release, but it does **not** subscribe to later repository pushes.
Publish later releases by importing again, using the CLI, or enabling Actions.

**CLI publishing** needs no repository workflow:

```bash
clawhub login
clawhub skill publish skills/<name> --dry-run
clawhub skill publish skills/<name>
```

Omit `--owner` to publish as the authenticated ClawHub user. Add
`--owner <handle>` only for a confirmed ClawHub organization or publisher the
user can manage. ClawHub skips unchanged content, starts a new skill at `1.0.0`,
and normally advances changed releases by patch version. This version stream is
separate from `skill.config.json.version`, which supplies Claude and Codex
plugin manifests.

**GitHub Actions publishing** is opt-in through `skill.config.json`:

```json
{
  "clawhub": {
    "githubActions": "manual",
    "publishBranch": "main"
  }
}
```

The supported modes are:

| Mode | Pull requests | Manual dispatch | Pushes |
| --- | --- | --- | --- |
| `"off"` | No ClawHub workflow | No | No |
| `"manual"` | Dry-run | Real publish | No |
| `"push"` | Dry-run | Real publish | Changes under `skills/` on `publishBranch` publish |

Run `npm run build` after changing the mode. It generates
`.github/workflows/clawhub-publish.yml` with ClawHub's reusable skill workflow
from the currently documented `main` ref. Verify that both the ref and workflow
path still resolve before enabling publishing:

```bash
gh api --method GET \
  "repos/openclaw/clawhub/contents/.github/workflows/skill-publish.yml?ref=main" \
  --silent
```

The command exits unsuccessfully if GitHub cannot resolve the ref or file. Do
not edit that YAML directly; `npm run check` treats it like every other
generated adapter.

Real Actions publishes require a ClawHub token stored as the GitHub repository
Actions secret `CLAWHUB_TOKEN`. Create it through **Settings → Secrets and
variables → Actions**, or interactively:

```bash
gh secret set CLAWHUB_TOKEN
```

Never put the token in `skill.config.json`, workflow YAML, source, logs, or a
chat prompt. Commit the generated workflow to the repository's default branch.
For manual mode, open **Actions → Publish skills to ClawHub → Run workflow**, or
run:

```bash
gh workflow run clawhub-publish.yml --ref main
gh run watch
```

Set the optional, separately confirmed ClawHub publisher handle when publishing
to an organization:

```json
{
  "clawhub": {
    "githubActions": "push",
    "publishBranch": "main",
    "owner": "my-clawhub-organization"
  }
}
```

Do not infer this handle from the GitHub repository organization or the general
`owner` metadata. If `clawhub.owner` is omitted, the user authenticated by
`CLAWHUB_TOKEN` publishes.

An initial web GitHub import followed by Actions works when the token can manage
the same ClawHub owner and the folder-derived slug still identifies the imported
skill. The workflow publishes new releases; it is not two-way synchronization,
and removing a skill from GitHub does not delete its ClawHub listing.

Before a first release, re-check ClawHub's current
[publishing](https://docs.openclaw.ai/clawhub/publishing),
[CLI](https://docs.openclaw.ai/clawhub/cli), and
[skill-format](https://docs.openclaw.ai/clawhub/skill-format) documentation.

### Licensing

ClawHub publishes skills under MIT-0, so a destination's `license` field
defaults to `MIT-0` and no `LICENSE` file is copied. That field describes the
distributed skill — it is what the generated Claude and Codex plugin manifests
carry, and the plugin is `skills/<name>/`. A `LICENSE` at the project root
describes the project: tooling, README, evaluations, assets, CI. The two may
differ. The agent offers three shapes:

| Shape | `license` | Root `LICENSE` | `skills/<name>/LICENSE` |
| --- | --- | --- | --- |
| MIT-0 throughout (default) | `MIT-0` | MIT-0 | — |
| One attribution licence | e.g. `MIT` | MIT | — |
| Split project and skill | `MIT-0` | your choice | MIT-0 |

MIT-0 is MIT without the attribution clause, so one grant satisfies every
channel above. Choose an attribution licence if you want one — MIT and
Apache-2.0 are ordinary choices — knowing what ClawHub does with it.

The split exists because a repository holds more than its skill, so you may want
attribution on the project while the portable skill travels freely. `npm run
build` copies the whole skill directory, so a licence inside `skills/<name>/`
reaches every generated discovery copy and every channel that reads the
canonical directory. It is not a way to keep attribution on the skill: MIT-0 is
the more permissive grant, it travels with each distributed copy, and a copy
released under it cannot be pulled back under attribution terms later.

Whichever shape you pick, write the files yourself. `npm run validate` warns
when the project root has no `LICENSE` at all, but it does not read licence
text, so matching the files to the field is your call.

## Validation and compatibility

The test suite runs on Windows and Ubuntu against both Node 22 and Node 24, the
maintenance and active LTS lines that `engines` spans. CI validates
the pristine template and also runs an npm-package boundary harness. That
harness creates a local `npm pack` tarball from the current, possibly unpushed
working tree; installs it; mints a real destination through its `bin` command;
then upgrades a destination from a simulated previous packed release. It proves
that canonical skill bytes survive migration and that the resulting
destination's unmodified `npm test` passes.

Using a tarball rather than copying source is deliberate: it detects missing
published files, broken `bin` or installed-path behavior, and undeclared
dependencies before release. The suite also covers portable Agent Skills
constraints, generated Codex schemas, byte-preserving copy behavior, CRLF and
nested YAML handling, single/bundle rules, generated drift, and Claude's
official `plugin validate` command.

The generated adapters are code, not hand-maintained copies, so schema updates
happen in one place.

CI exercises generated ClawHub workflow structure and recognized OpenClaw
metadata preflights, but it does not perform a live ClawHub publish or reproduce
ClawHub's server-side security analysis. Claude's official `plugin validate`
also runs. The ClawHub and Hermes commands above were checked against vendor
documentation on 2026-07-28 and are accurate as of that date. Treat them as a
starting point and confirm against current vendor docs before a first publish.

Releases are cut by `.github/workflows/release.yml` on a `v*` tag. The tag must
equal `v` plus `package.json`'s version. The workflow runs the same suite,
publishes the public `@neefactory/skillsmithy` package with npm provenance,
builds the archive with `git archive`, and attaches a SHA-256 sum alongside a
signed provenance attestation. Configure the repository's `NPM_TOKEN` secret
with publish access to the `@neefactory` scope before cutting a release. Nothing
about the release is assembled by hand.

Git itself is optional for local or CLI-only projects. `npm run doctor` reports
a missing repository or remote as information when Actions are off, and as a
warning when ClawHub Actions are enabled. A remote that disagrees with
`skill.config.json` is always flagged.

[releases]: https://github.com/neefactory/skillsmithy/releases/latest
