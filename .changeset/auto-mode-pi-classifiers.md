---
"@counterposition/pi-auto-mode": minor
---

# pi-auto-mode

Ask the classifier through Pi. Auto mode now runs any classifier model in Pi's
catalog, named by `model` as `provider/id` (default `typesafe/jev-latest`),
with the credentials Pi has for that provider. Jev 1.13 works through TypeSafe,
OpenRouter (`openrouter/typesafe/jev-1.13`), and OpenCode (`opencode/jev-1.13`)
with the tuned thresholds; any other model needs its own `thresholds`.

Breaking: `apiKey` and `url` are gone from `auto-mode.json`, and a config that
still sets them turns auto mode off with a message. Give Pi the key instead:
`TYPESAFE_API_KEY`, or a `typesafe` entry in `~/.pi/agent/auth.json` (which can
read the macOS Keychain with `!security find-generic-password -s
TYPESAFE_API_KEY -w`). The `intent` threshold is now 0.5, re-tuned through Pi.
Classifier failures other than timeouts are reported once and shown in `/auto`
until a request works again.
