---
"@counterposition/pi-web-search": patch
---

# pi-web-search

Fix the web-content prompt-injection guard so the extension returns the updated
`before_agent_start` system prompt instead of mutating the event object. Pi reads
system-prompt changes from the handler's return value, so the previous mutation
of `event.systemPrompt` did not reach the active prompt.
