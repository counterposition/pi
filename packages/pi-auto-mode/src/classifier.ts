import type { ClassifierApi, ClassifierModel, JsonObject } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { QUESTION_IDS, QUESTIONS } from "./questions.js";
import type { Answers } from "./questions.js";
import type { ClassifierState } from "./state.js";

export type Classifier = ClassifierModel<ClassifierApi>;

export type ClassifierErrorKind = "timeout" | "aborted" | "failed" | "malformed";

export class ClassifierError extends Error {
  constructor(
    readonly kind: ClassifierErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ClassifierError";
  }
}

/** Splits `provider/id` at the first slash, since model IDs may contain slashes. */
export function parseModel(spec: string): { provider: string; id: string } | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { provider: spec.slice(0, slash), id: spec.slice(slash + 1) };
}

/** Why the configured model cannot be used, or the model itself. */
export async function findClassifier(
  models: ModelRegistry,
  spec: string,
): Promise<Classifier | { problem: string }> {
  const parsed = parseModel(spec);
  if (!parsed) return { problem: `model '${spec}' must be provider/id` };
  const model = models.findOfType("classifier", parsed.provider, parsed.id);
  if (!model) return { problem: `Pi has no classifier model '${spec}'` };
  const available = await models.getAvailableOfType("classifier", parsed.provider);
  if (!available.some((m) => m.id === parsed.id)) {
    return { problem: `no ${parsed.provider} credentials for ${spec}` };
  }
  return model;
}

export interface ClassifierRequest {
  models: ModelRegistry;
  model: Classifier;
  state: ClassifierState;
  timeoutMs: number;
  /** The agent run's signal: aborting the run stops the wait. */
  signal?: AbortSignal;
}

export interface ClassifierAnswers {
  answers: Answers;
  latencyMs: number;
}

/** One attempt, bounded by `timeoutMs`; rejects with a `ClassifierError`. */
export async function askClassifier({
  models,
  model,
  state,
  timeoutMs,
  signal,
}: ClassifierRequest): Promise<ClassifierAnswers> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  let status: number | undefined;
  const result = await models.classify(
    model,
    { state: state as unknown as JsonObject, questions: QUESTIONS },
    {
      maxRetries: 0,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Pi reports no HTTP status for a failed request; the trail keeps it.
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        status = response.status;
        return response;
      },
    },
  );
  if (result.stopReason !== "stop") {
    if (timeout.aborted)
      throw new ClassifierError("timeout", "the classifier did not answer in time");
    if (result.stopReason === "aborted")
      throw new ClassifierError("aborted", "the agent run stopped");
    throw new ClassifierError("failed", result.errorMessage ?? "the classifier failed", status);
  }
  const answers = {} as Answers;
  for (const id of QUESTION_IDS) {
    const answer = result.answers[id];
    const value = answer?.type === "bool" ? answer.probability : undefined;
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ClassifierError("malformed", `answer '${id}' is missing or out of range`);
    }
    answers[id] = value;
  }
  return { answers, latencyMs: Math.round(performance.now() - started) };
}
