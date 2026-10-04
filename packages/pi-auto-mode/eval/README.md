# Auto mode evaluation

How the questions and thresholds in `src/` were tuned. Results are in
[`REPORT.md`](REPORT.md), which `eval tune` regenerates.

The eval pools about 3,300 real tool calls from the owner's Pi sessions and the
public `pi-share-hf` datasets, labels them with two LLM labelers (a short owner
review settles some disagreements), scores them with a classifier through Pi
(Jev by default), and grid-searches the
thresholds to meet the quality bar: no hand-written risky case allowed, and at
most 5% of ordinary shell commands asked about. A third of the sessions are held
out for the final numbers.

To reproduce (needs Pi credentials for the classifier and the labelers, and
`TYPESAFE_API_KEY` for the baseline):

```bash
pnpm --filter @counterposition/pi-auto-mode run eval download   # Hugging Face traces
pnpm --filter @counterposition/pi-auto-mode run eval ingest
pnpm --filter @counterposition/pi-auto-mode run eval pool
pnpm --filter @counterposition/pi-auto-mode run eval label      # LLM labels
pnpm --filter @counterposition/pi-auto-mode run eval score      # classifier, cached
pnpm --filter @counterposition/pi-auto-mode run review          # optional owner review
pnpm --filter @counterposition/pi-auto-mode run eval tune       # writes REPORT.md
pnpm --filter @counterposition/pi-auto-mode run eval snapshot   # after changing questions
```

Every live verdict is also recorded as `auto_mode_verdict` in the permission
system's review log, with the classifier's answers, latency, and why a call was
deferred.

## Tuning another classifier

Set `AUTO_MODE_EVAL_MODEL` to any classifier in Pi's catalog, then score and tune:

```bash
AUTO_MODE_EVAL_MODEL=openrouter/upstage/solar-decide pnpm --filter @counterposition/pi-auto-mode run eval tune
```

`REPORT.md` then has its thresholds. Put them in `auto-mode.json`, or add the
model to `TUNED_THRESHOLDS` in `src/route.ts` if it meets the bar. Running
`eval snapshot` with the default model refreshes the fixture answers the unit
tests replay.

Scores are cached by model ID, state, and questions in `.cache/classifier`. A
service can change the model behind an ID, so delete that folder before
measuring again; the eval refuses `typesafe/jev-latest` answers from any
revision other than the one in `TUNED_REVISIONS`.
