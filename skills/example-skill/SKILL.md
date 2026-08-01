---
name: example-skill
description: Template-only placeholder for demonstrating Skill Smithy. Do not invoke this skill for user work; create an external project with npm run mint or npm run import.
---

# Example Skill

Treat this directory as disposable template material. Keep this checkout
pristine and create a separate project:

`npm run mint -- <skill-name> --out-dir <destination>`

For an existing skill, run:

`npm run import -- <skill-path> --out-dir <destination>`

In the destination project:

1. Put all activation guidance in the frontmatter description.
2. Write concise imperative instructions in the body.
3. Add scripts, references, or assets only when the workflow needs them.
4. Run `npm test` before publishing.
