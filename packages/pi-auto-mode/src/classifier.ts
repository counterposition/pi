import type {
  ClassifierApi,
  ClassifierModel,
  ClassifierResult,
  JsonObject,
} from "@earendil-works/pi-ai";
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

/** The catalog model for `spec`, or why there is none. */
export function findClassifier(
  models: ModelRegistry,
  spec: string,
): Classifier | { problem: string } {
  const parsed = parseModel(spec);
  if (!parsed) return { problem: `model '${spec}' must be provider/id` };
  return (
    models.findOfType("classifier", parsed.provider, parsed.id) ?? {
      problem: `Pi has no classifier model '${spec}'`,
    }
  );
}

/** Whether Pi has credentials for the model's provider. May reject, like credential storage. */
export async function hasCredentials(
  models: ModelRegistry,
  model: Classifier,
  signal?: AbortSignal,
): Promise<boolean> {
  const available = await models.getAvailableOfType("classifier", model.provider, { signal });
  return available.some((m) => m.id === model.id);
}

/** The model a System One response says it served, when the body names one. */
export async function servedModel(response: Response): Promise<string | undefined> {
  if (!response.ok) return undefined;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  return isRecord(body) && typeof body.model === "string" ? body.model : undefined;
}

/** Every question's probability, checked: Pi does not bound them to [0, 1]. */
export function toAnswers(result: ClassifierResult): Answers {
  const answers = {} as Answers;
  for (const id of QUESTION_IDS) {
    const answer = result.answers[id];
    const value = answer?.type === "bool" ? answer.probability : undefined;
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ClassifierError("malformed", `answer '${id}' is missing or out of range`);
    }
    answers[id] = value;
  }
  return answers;
}

export interface ClassifierRequest {
  models: ModelRegistry;
  model: Classifier;
  state: ClassifierState;
  timeoutMs: number;
  /** The agent run's signal: aborting the run stops the wait. */
  signal?: AbortSignal;
  /** For a model alias, the revision its thresholds were tuned on; any other is refused. */
  revision?: string;
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
  revision,
}: ClassifierRequest): Promise<ClassifierAnswers> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  let status: number | undefined;
  let served: string | undefined;
  const result = await models.classify(
    model,
    { state: state as unknown as JsonObject, questions: QUESTIONS },
    {
      maxRetries: 0,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // Pi reports neither the HTTP status of a failure nor the model a service served.
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        status = response.status;
        if (revision) served = await servedModel(response);
        return response;
      },
    },
  );
  // A provider may still answer after the deadline or the run ended; that answer is too late.
  if (timeout.aborted)
    throw new ClassifierError("timeout", "the classifier did not answer in time");
  if (signal?.aborted || result.stopReason === "aborted") {
    throw new ClassifierError("aborted", "the agent run stopped");
  }
  if (result.stopReason !== "stop") {
    throw new ClassifierError("failed", result.errorMessage ?? "the classifier failed", status);
  }
  if (revision && served !== revision) {
    throw new ClassifierError(
      "failed",
      `${model.provider}/${model.id} served ${served ?? "an unnamed model"}, not ${revision}, which its thresholds were tuned for: update pi-auto-mode, or choose another model`,
    );
  }
  return { answers: toAnswers(result), latencyMs: Math.round(performance.now() - started) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
