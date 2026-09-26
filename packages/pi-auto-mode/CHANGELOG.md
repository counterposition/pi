# Changelog

## 0.1.0

### Minor Changes

- First version: an `auto-mode` authorizer link for `@gotgenes/pi-permission-system` that asks
  TypeSafe's Jev whether a pending bash, custom-tool, or MCP call can run without a human.
  Flagged calls go to the approval dialog (or are denied headless with a reason); failures and
  unverifiable calls always go to the dialog. Includes `/auto on|off|shadow|status`, review-log
  verdicts, and an evaluation harness with tuned thresholds.
