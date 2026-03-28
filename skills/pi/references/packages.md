# Pi Packages

Packages bundle extensions, skills, prompt templates, and themes for sharing via npm, git, or local paths.

**Security warning:** Packages run with full system access. Extensions execute arbitrary code, skills can instruct the model to perform any action. Review source before installing third-party packages.

## Installation

```bash
# From npm
pi install npm:@foo/pi-extensions@1.0.0

# From git
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo.git
pi install git@github.com:user/repo.git

# From local path
pi install ./my-package
pi install /absolute/path/to/package

# Project-local install (writes to .pi/settings.json for team sharing)
pi install -l npm:@foo/pi-extensions

# Temporary trial (loads for current session, doesn't install)
pi -e npm:@foo/pi-extensions
```

## Management Commands

```bash
pi list              # List installed packages
pi update            # Update non-pinned packages
pi remove <pkg>      # Remove a package
```

## Package Structure

### Convention-Based (Auto-Discovery)

Place files in standard directories — Pi discovers them automatically:

```text
my-pi-package/
├── package.json          # npm package metadata + optional pi manifest
├── extensions/           # .ts and .js files → loaded as extensions
│   └── my-ext.ts
├── skills/               # Directories with SKILL.md → loaded as skills
│   └── my-skill/
│       └── SKILL.md
├── prompts/              # .md files → loaded as prompt templates
│   └── review.md
└── themes/               # .json files → loaded as themes
    └── my-theme.json
```

### Manifest-Based (Explicit)

Declare resources in `package.json` under the `pi` key:

```json
{
  "name": "@foo/pi-extensions",
  "version": "1.0.0",
  "pi": {
    "extensions": ["src/ext1.ts", "src/ext2.ts"],
    "skills": ["skills/my-skill"],
    "prompts": ["prompts/"],
    "themes": ["themes/custom.json"]
  }
}
```

Both approaches can be combined. Explicit paths in the `pi` manifest take precedence.

## Dependencies

- **Standard npm dependencies:** Declare in `package.json` → `dependencies` as usual. They're installed with the package.
- **Pi peer dependencies** (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, etc.): Use `"*"` as the version range in `peerDependencies`. Do NOT bundle these.
- **Other Pi packages:** If your package depends on another Pi package, it must be bundled explicitly.

## Publishing to npm

```bash
cd my-pi-package
npm publish
```

Users install with `pi install npm:@foo/pi-extensions`.

## Deduplication

When the same resource name appears from multiple sources:

- Project-level packages override global ones
- First discovery wins for same-level conflicts
- Pi warns about collisions
