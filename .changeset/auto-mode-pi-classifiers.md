---
"@counterposition/pi-auto-mode": minor
---

# pi-auto-mode

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
