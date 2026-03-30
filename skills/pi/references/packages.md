# Pi Packages

Pi packages bundle extensions, skills, prompt templates, and themes so they can be shared through npm, git, or local paths.

**Security warning:** Pi packages run with full system access. Review third-party source before installing it.

## Install and Manage

```bash
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo
pi install /absolute/path/to/package
pi install ./relative/path/to/package

pi remove npm:@foo/bar
pi uninstall npm:@foo/bar
pi list
pi update
pi config
```

By default, `install` and `remove` write to global settings (`~/.pi/agent/settings.json`). Use `-l` to write to project settings (`.pi/settings.json`) instead.

Project installs are shareable with a team. Pi will install missing project packages automatically on startup.

For temporary one-run testing, use `--extension` / `-e` with an npm or git source. Pi installs it into a temporary directory for that run only.

## Package Sources

### npm

```text
npm:@scope/pkg@1.2.3
npm:pkg
```

- Global installs use `npm install -g`
- Project installs go under `.pi/npm/`
- Version-pinned installs are skipped by `pi update`
- Use `npmCommand` in settings if you need a wrapper such as `mise` or `asdf`

### git

```text
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Global clones live in `~/.pi/agent/git/`
- Project clones live in `.pi/git/`
- Refs pin the package and are skipped by `pi update`
- Pi runs `npm install` after clone/pull when `package.json` exists

### local paths

- Files are treated as single extensions
- Directories are loaded using normal package rules
- Relative paths resolve relative to the settings file they appear in

## Creating a Package

Pi supports either a `pi` manifest in `package.json` or convention-based directories.

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

If there is no `pi` manifest, Pi auto-discovers:

- `extensions/` for `.ts` / `.js`
- `skills/` for `SKILL.md` directories and top-level `.md` skill files
- `prompts/` for `.md`
- `themes/` for `.json`

## Dependencies

- Normal runtime dependencies belong in `dependencies`
- Pi core libraries should be peer deps with `"*"` ranges:
  - `@mariozechner/pi-ai`
  - `@mariozechner/pi-agent-core`
  - `@mariozechner/pi-coding-agent`
  - `@mariozechner/pi-tui`
  - `@sinclair/typebox`
- Other Pi packages must be bundled explicitly if your package depends on them

## Package Filtering

`settings.json` can narrow package resources with object-form entries:

```json
{
  "packages": [
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

Rules:

- Omit a key to load all resources of that type
- Use `[]` to load none
- Use `!pattern` to exclude glob matches
- Use `+path` / `-path` for exact include or exclude

## Scope and Deduplication

- Project settings override global settings for the same package identity
- Identity is package name for npm, repo URL for git, and resolved absolute path for local sources
- `pi config` can enable or disable package resources after installation
