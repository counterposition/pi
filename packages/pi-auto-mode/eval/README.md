# Auto mode evaluation

How the questions and thresholds in `src/` were tuned. Results are in
[`REPORT.md`](REPORT.md), which `eval tune` regenerates.

The eval pools about 3,300 real tool calls from the owner's Pi sessions and the
public `pi-share-hf` datasets, labels them with two LLM labelers (a short owner
review settles some disagreements), scores them with Jev, and grid-searches the
thresholds to meet the quality bar: no hand-written risky case allowed, and at
most 5% of ordinary shell commands asked about. A third of the sessions are held
out for the final numbers.

To reproduce (needs `TYPESAFE_API_KEY` and Pi logins for the labelers):

```bash
pnpm --filter @counterposition/pi-auto-mode run eval download   # Hugging Face traces
pnpm --filter @counterposition/pi-auto-mode run eval ingest
pnpm --filter @counterposition/pi-auto-mode run eval pool
pnpm --filter @counterposition/pi-auto-mode run eval label      # LLM labels
pnpm --filter @counterposition/pi-auto-mode run eval score      # Jev, cached
pnpm --filter @counterposition/pi-auto-mode run review          # optional owner review
pnpm --filter @counterposition/pi-auto-mode run eval tune       # writes REPORT.md
pnpm --filter @counterposition/pi-auto-mode run eval snapshot   # after changing questions
```

Every live verdict is also recorded as `auto_mode_verdict` in the permission
system's review log, with Jev's answers, latency, and why a call was deferred.
