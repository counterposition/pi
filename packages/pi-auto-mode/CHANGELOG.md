# Changelog

## 0.4.0

### Minor Changes

- 3f436bc: # pi-auto-mode

  Ask the classifier through Pi. Auto mode now runs any classifier model in Pi's
  catalog, named by `model` as `provider/id` (default `typesafe/jev-latest`),
  with the credentials Pi has for that provider. Jev 1.13 through TypeSafe or
  OpenRouter (`openrouter/typesafe/jev-1.13`) uses the tuned thresholds; any other
  model, such as Cloudflare's Clef, needs its own `thresholds`. If TypeSafe moves
  `jev-latest` past 1.13, auto mode asks you about every call until it is tuned for
  the new version. An answer that arrives after the timeout or after the run
  stopped is no longer used.

  Breaking: `apiKey` and `url` are gone from `auto-mode.json`, and a config that
  still sets them turns auto mode off with a message. Give Pi the key instead:
  `TYPESAFE_API_KEY`, or a `typesafe` entry in `~/.pi/agent/auth.json` (which can
  read the macOS Keychain with `!security find-generic-password -s
TYPESAFE_API_KEY -w`). The thresholds were re-tuned through Pi: `safe` 0.25, `intent` 0.54, `hard` 0.5.
  Classifier failures other than timeouts are reported once and shown in `/auto`
  until a request works again.

- 66bae17: # Require Pi 1.0.2

  Require Pi 1.0.2 or newer, the version the packages are now tested with.

## 0.3.0

### Minor Changes

- 20bd3ea: # Require Pi 1.0.0

  Require Pi 1.0.0 or newer. Older Pi versions are no longer tested.

## 0.2.0

### Minor Changes

- ecdda44: # pi-auto-mode

  Send tool calls made from codemode scripts, including MCP tools, to Jev too. Before, Jev
  never saw them: they always asked you, or were refused without a UI. A call made by another tool
  is judged on its own input, and only while every call above it is still running.

## 0.1.1

### Patch Changes

- 5dbcacb: # pi-auto-mode

  Add a demo GIF to the README and document how API keys are stored on Linux.

## 0.1.0

### Minor Changes

- First version: an `auto-mode` authorizer link for `@gotgenes/pi-permission-system` that asks
  TypeSafe's Jev whether a pending bash, custom-tool, or MCP call can run without a human.
  Flagged calls go to the approval dialog (or are denied headless with a reason); failures and
  unverifiable calls always go to the dialog. Includes `/auto on|off|shadow|status`, review-log
  verdicts, and an evaluation harness with tuned thresholds.
