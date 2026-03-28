# Publishing

## npm First

npm is the primary registry for Pi-installable packages in this repo.

- `@counterposition/skill-pi` ships the `pi` skill for `pi install npm:@counterposition/skill-pi`.
- `@counterposition/pi-web-search` ships the web search extension for `pi install npm:@counterposition/pi-web-search`.

All publishable packages must include:

- `README.md`
- `LICENSE.md`
- `repository.directory`
- `publishConfig.access = public`
- a `files` allowlist

## Release Flow

1. Add a changeset for every user-facing npm package change.
2. Merge to `main`.
3. `release-npm.yml` opens or updates the Changesets release PR.
4. Merging the release PR publishes changed packages with provenance enabled.

## JSR Policy

JSR stays opt-in and dormant until a package is both reusable and Pi-agnostic.

Good JSR candidates:

- shared search utilities
- parsing and formatting helpers
- Pi-adjacent SDK helpers that are useful outside `pi install`

Not JSR candidates:

- repo-managed skills under `skills/`
- Pi extension bundles whose primary install surface is npm + `pi install`

Only add `jsr.json` and enable publishing when a package clearly fits that model.
