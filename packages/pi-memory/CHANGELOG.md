# Changelog

## 0.2.4

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.87 line so
  typecheck and tests run against the Pi release users actually run (0.87.1).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies, and none of the Pi 0.84.3–0.87.1 breaking changes
  (`finishTurn`, canonical `SessionManager` context, `TranscriptContext`
  provider streams, JSON-only tool `details`, fail-closed `user_bash`) touch
  its extension surface.

## 0.2.3

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.84 line so
  typecheck and tests run against the Pi release users actually run (0.84.2).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies, and its entire extension-facing surface
  (`StringEnum`, `withFileMutationQueue`, the `before_agent_start` /
  `tool_call` result shapes, and TypeBox schemas) is unchanged in Pi
  0.81–0.84; typebox moves to ^1.3.16 to match Pi 0.83's bundled TypeBox.

## 0.2.2

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.80 line so
  typecheck and tests run against the Pi release users actually run (0.80.3).
  Runtime is unchanged — the extension still declares the Pi core libraries as
  `"*"` peer dependencies and only imports `StringEnum`, which remains on the
  pi-ai root entrypoint after the 0.80.0 move of the old global API to
  `@earendil-works/pi-ai/compat`.

## 0.2.1

### Patch Changes

- Align the Pi dev dependencies with the current `@earendil-works/*` 0.78 line so
  typecheck and tests run against the Pi release users actually run. Runtime is
  unchanged — the extension still declares the Pi core libraries as `"*"` peer
  dependencies and uses only stable extension APIs.

## 0.2.0

### Minor Changes

- Update Pi peer dependencies and extension imports to the official
  `@earendil-works/*` package scope for Pi 0.74.
- Treat `typebox` as a Pi-provided peer dependency for extension schemas.

## 0.1.0

### Minor Changes

- Initial durable Markdown-backed memory package for Pi.
