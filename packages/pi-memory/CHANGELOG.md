# Changelog

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
