import { QUESTION_IDS, QUESTIONS } from "./questions.js";
import type { Answers } from "./questions.js";
import type { JevState } from "./state.js";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

export type JevErrorKind = "timeout" | "http" | "network" | "malformed";

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

export interface JevRequest {
  apiKey: string;
  model: string;
  state: JevState;
  timeoutMs: number;
  url?: string;
  fetch?: typeof fetch;
}

export interface JevResult {
  answers: Answers;
  model: string;
  latencyMs: number;
  inputTokens?: number;
}

export async function askJev({
  apiKey,
  model,
  state,
  timeoutMs,
  url = JEV_URL,
  fetch: doFetch = fetch,
}: JevRequest): Promise<JevResult> {
  const started = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let body: unknown;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions: QUESTIONS }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new JevError("http", `HTTP ${response.status}: ${text.slice(0, 200)}`, response.status);
    }
    body = await response.json().catch(() => {
      throw new JevError("malformed", "response is not JSON");
    });
  } catch (error: unknown) {
    throw normalize(error, signal);
  }
  return { ...parseAnswers(body), latencyMs: Math.round(performance.now() - started) };
}

export function parseAnswers(body: unknown): Omit<JevResult, "latencyMs"> {
  if (!isRecord(body) || !isRecord(body.answers)) {
    throw new JevError("malformed", "response has no answers");
  }
  const answers = {} as Answers;
  for (const id of QUESTION_IDS) {
    const answer = body.answers[id];
    const value = isRecord(answer) ? answer.noul : undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new JevError("malformed", `answer '${id}' is missing or out of range`);
    }
    answers[id] = value;
  }
  const usage = isRecord(body.usage) ? body.usage : undefined;
  return {
    answers,
    model: typeof body.model === "string" ? body.model : "unknown",
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
  };
}

function normalize(error: unknown, signal: AbortSignal): JevError {
  if (signal.aborted) return new JevError("timeout", "Jev did not answer in time");
  if (error instanceof JevError) return error;
  const err = error instanceof Error ? error : new Error(String(error));
  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return new JevError("timeout", "Jev did not answer in time");
  }
  return new JevError("network", err.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
