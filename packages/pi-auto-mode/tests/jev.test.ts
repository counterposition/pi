import { describe, expect, it, vi } from "vitest";

import { askJev, JevError, parseAnswers } from "../src/jev.js";
import { QUESTION_IDS } from "../src/questions.js";
import type { JevState } from "../src/state.js";

const state: JevState = {
  user_messages: ["run the tests"],
  earlier_actions: [],
  action: { tool: "bash", input: { command: "pnpm test" } },
  cwd: "/repo",
  environment: [],
};

const goodBody = () => ({
  model: "jev-1.13.0",
  answers: Object.fromEntries(QUESTION_IDS.map((id) => [id, { type: "noul", noul: 0.1 }])),
  usage: { input_tokens: 900, output_tokens: 20 },
});

const request = (fetch: typeof globalThis.fetch, timeoutMs = 2000) =>
  askJev({ apiKey: "k", model: "jev-1.13.0", state, timeoutMs, fetch });

const rejection = async (promise: Promise<unknown>): Promise<JevError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JevError);
  return error as JevError;
};

describe("askJev", () => {
  it("sends state and questions and returns validated answers", async () => {
    const fetch = vi.fn(async () => Response.json(goodBody()));
    const result = await request(fetch);

    expect(result.answers.requested).toBe(0.1);
    expect(result.model).toBe("jev-1.13.0");
    expect(result.inputTokens).toBe(900);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("jev-1.13.0");
    expect(body.state).toEqual(state);
    expect(Object.keys(body.questions as object)).toEqual(QUESTION_IDS);
  });

  it("reports HTTP errors with their status", async () => {
    const error = await rejection(
      request(async () => new Response("rate limited", { status: 429 })),
    );
    expect(error.kind).toBe("http");
    expect(error.status).toBe(429);
  });

  it("times out a slow response", async () => {
    const slow: typeof globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    expect((await rejection(request(slow, 20))).kind).toBe("timeout");
  });

  it("reports network failures", async () => {
    const error = await rejection(
      request(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(error.kind).toBe("network");
  });

  it("rejects non-JSON bodies", async () => {
    expect((await rejection(request(async () => new Response("<html>")))).kind).toBe("malformed");
  });
});

describe("parseAnswers", () => {
  it.each([
    ["no answers", {}],
    ["a missing answer", { answers: { irreversible: { noul: 0.1 } } }],
    [
      "an out-of-range answer",
      { answers: { ...goodBody().answers, opaque: { type: "noul", noul: 1.5 } } },
    ],
    [
      "a non-numeric answer",
      { answers: { ...goodBody().answers, requested: { type: "noul", noul: "yes" } } },
    ],
  ])("rejects %s", (_name, body) => {
    expect(() => parseAnswers(body)).toThrow(JevError);
  });
});
