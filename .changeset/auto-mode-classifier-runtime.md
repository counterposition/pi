---
"@counterposition/pi-auto-mode": minor
---

# pi-auto-mode

Ask Jev through Pi's classifier runtime instead of auto-mode's own HTTP client. The request is
unchanged: the same model, endpoint, questions, and API key, one attempt, and the same timeout.
Auto mode now needs Pi 0.99 or newer; on older Pi it says so once and every ask comes to you.
A `url` in `auto-mode.json` must now end in `/systemone`.
