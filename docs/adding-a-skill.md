# Adding a Skill

## Canonical Source

1. Create `skills/<name>/`.
2. Add `SKILL.md` with frontmatter.
3. Add `README.md` with install instructions and key files.
4. Add `references/` and `evals/` when the skill needs them.

## Validation Rules

Each skill must have:

- `SKILL.md`
- frontmatter with `name` and `description`
- a directory name that matches `name`
- `README.md`

Run:

```bash
pnpm run validate:skills
```

## Optional npm Distribution

If the skill should also be installable with `pi install`:

1. Create `packages/skill-<name>/`.
2. Ship exactly one skill under `packages/skill-<name>/skills/<name>/`.
3. Set `pi.skills` in that package's `package.json`.
4. Use `pnpm run sync:skills` before packing or publishing.

Users should still be able to install the canonical skill from GitHub with:

```bash
npx skills add <owner>/<repo> --skill <name>
```
