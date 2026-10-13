---
"@counterposition/pi-auto-mode": minor
"@counterposition/pi-web-search": minor
---

# Require Pi 1.2.0

Require Pi 1.2.0 or newer, the version the packages are now tested with. On Pi
1.2.0, their system prompt sections also reach runs that extensions start with
`pi.sendMessage(..., { triggerTurn: true })`. Web search declares `max_results`,
`offset`, and `max_chars` as whole numbers, so models see them as integers.
