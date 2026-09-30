import type {
  ClassifierApi,
  ClassifierModel,
  ClassifierResult,
  JsonObject,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { QUESTION_IDS, QUESTIONS } from "./questions.js";
import type { Answers } from "./questions.js";
import type { JevState } from "./state.js";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

export type JevErrorKind = "timeout" | "aborted" | "http" | "network" | "malformed";

export class JevError extends Error {
  constructor(
    readonly kind: JevErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

/**
 * Pi's TypeSafe classifier, sent as `model` to `url`, or undefined when Pi is older
 * than 0.99 and has no classifier runtime. `url` must end in `/systemone`.
 */
export function jevModel(
  models: ModelRegistry,
  { model, url }: { model: string; url: string },
): ClassifierModel<ClassifierApi> | undefined {
  if (typeof models.classify !== "function" || typeof models.findOfType !== "function") {
    return undefined;
  }
  const typesafe = models.findOfType("classifier", "typesafe", "jev-latest");
  return typesafe && { ...typesafe, id: model, baseUrl: url.slice(0, -"systemone".length) };
}

export interface JevRequest {
  models: ModelRegistry;
  model: ClassifierModel<ClassifierApi>;
  apiKey: string;
  state: JevState;
  timeoutMs: number;
  /** The agent run's signal: aborting the run stops the wait. */
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface JevResult {
  answers: Answers;
  model: string;
  latencyMs: number;
}

/** Pi sends the public `bool` type as TypeSafe's `noul`, so the wire request is unchanged. */
const BOOL_QUESTIONS = Object.fromEntries(
  QUESTION_IDS.map((id) => [id, { ...QUESTIONS[id], type: "bool" as const }]),
);

export async function askJev({
  models,
  model,
  apiKey,
  state,
  timeoutMs,
  signal,
  fetch: doFetch = fetch,
}: JevRequest): Promise<JevResult> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response | undefined;
  const result = await models.classify(
    model,
    { state: state as unknown as JsonObject, questions: BOOL_QUESTIONS },
    {
      apiKey,
      maxRetries: 0,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      fetch: async (input, init) => (response = await doFetch(input, init)),
    },
  );
  if (result.stopReason !== "stop") throw failure(result, timeout, response);
  const answers = {} as Answers;
  for (const id of QUESTION_IDS) {
    const answer = result.answers[id];
    const value = answer?.type === "bool" ? answer.probability : undefined;
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new JevError("malformed", `answer '${id}' is missing or out of range`);
    }
    answers[id] = value;
  }
  return { answers, model: result.model, latencyMs: Math.round(performance.now() - started) };
}

function failure(
  result: ClassifierResult,
  timeout: AbortSignal,
  response: Response | undefined,
): JevError {
  if (timeout.aborted) return new JevError("timeout", "Jev did not answer in time");
  if (result.stopReason === "aborted") return new JevError("aborted", "the agent run stopped");
  const message = result.errorMessage ?? "Jev failed";
  if (!response) return new JevError("network", message);
  if (!response.ok) return new JevError("http", message, response.status);
  return new JevError("malformed", message);
}
