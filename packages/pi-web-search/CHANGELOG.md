# Changelog

## Unreleased

### Changed

- Remove Firecrawl support from `pi-web-search` and keep `web_fetch` on the Jina backend only.
- Remove the `FIRECRAWL_API_KEY` configuration path.
- Remove the `preferredFetchProvider` setting.

## 0.2.1

### Metadata

- Add the `pi-extension` keyword so `pi.dev/packages` can classify the package as an extension directly from npm metadata.

## 0.1.2

### Documentation

- Update the README configuration section to explicitly name the supported search and fetch providers so the npm package docs are clearer for both humans and AI agents.

## 0.1.1

### Patch Changes

- Republish the package metadata update that adds the `pi-package` keyword so pi.dev can discover both npm packages.

This package uses Changesets for release notes and versioning.
