# Changelog

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
