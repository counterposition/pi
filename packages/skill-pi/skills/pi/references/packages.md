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
pi update                 # update pi only (changed in Pi 0.79.7)
pi update --all           # update pi + packages, reconcile pinned git refs
pi update --extensions    # update packages only
pi update --models        # refresh model catalogs only (Pi 0.80.8)
pi update --self          # update pi only
pi update <source>        # update one package
pi config                 # starts in global settings; Tab switches scope
pi config -l              # start in project overrides (.pi/settings.json)
```

By default, `install` and `remove` write to user settings (`~/.pi/agent/settings.json`). Use `-l` to write to project settings (`.pi/settings.json`) instead. `pi update` installs the exact version returned by the update check.

Package commands follow the project trust flow (`pi update` never prompts); pass `--approve`/`-a` or `--no-approve`/`-na` to trust or ignore project-local settings for one command.

Project installs are shareable with a team. Pi will install missing project packages automatically on startup once the project is trusted.

For temporary one-run testing, use `--extension` / `-e` with an npm or git source. Pi installs it into a temporary directory for that run only.

## Package Sources

### npm

```text
npm:@scope/pkg@1.2.3
npm:pkg
```

- User installs go under `~/.pi/agent/npm/`
- Project installs go under `.pi/npm/`
- Version-pinned installs are skipped by `pi update --extensions` / `--all`
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
- Refs pin the package; `pi update --extensions` / `--all` do not move them to newer refs but do reconcile the clone to the configured ref — use `pi install git:host/user/repo@new-ref` to move a pin
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
  - `@earendil-works/pi-ai`
  - `@earendil-works/pi-agent-core`
  - `@earendil-works/pi-coding-agent`
  - `@earendil-works/pi-tui`
  - `typebox`
- Other Pi packages must be bundled explicitly
- Git package installs run `npm install --omit=dev` — runtime needs go in `dependencies`, not `devDependencies`

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

- Project settings override global settings for the same package identity — unless the project entry has `autoload: false`, in which case it is applied as a delta over the global entry (Pi 0.80.4)
- Identity is package name for npm, repo URL for git, and resolved absolute path for local sources
- `pi config` can enable or disable package resources after installation; since Pi 0.80.4 it manages global vs project-local scopes (Tab to switch, `pi config -l` to start in project mode with inherited global resources dimmed)
