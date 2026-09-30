import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config.js";
import { askJev, JevError, jevModel } from "../src/jev.js";
import { QUESTION_IDS, QUESTIONS } from "../src/questions.js";
import type { JevState } from "../src/state.js";
import { models } from "./fixtures/models.js";

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

const request = (fetch: typeof globalThis.fetch, timeoutMs = 2000, signal?: AbortSignal) =>
  askJev({
    models,
    model: jevModel(models, DEFAULT_CONFIG)!,
    apiKey: "k",
    state,
    timeoutMs,
    signal,
    fetch,
  });

const rejection = async (promise: Promise<unknown>): Promise<JevError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(JevError);
  return error as JevError;
};

const hanging: typeof globalThis.fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("askJev", () => {
  it("sends the same request as before Pi's classifier runtime and returns validated answers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(goodBody()));
    const result = await request(fetch);

    expect(result.answers.requested).toBe(0.1);
    expect(result.model).toBe("jev-1.13.0");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer k");
    expect(init?.body).toBe(JSON.stringify({ model: "jev-1.13.0", state, questions: QUESTIONS }));
  });

  it("sends a configured endpoint unchanged", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(goodBody()));
    const url = "http://127.0.0.1:8080/proxy/v1/systemone";
    await askJev({
      models,
      model: jevModel(models, { model: "jev-1.13.0", url })!,
      apiKey: "k",
      state,
      timeoutMs: 2000,
      fetch,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(url);
  });

  it("reports HTTP errors with their status, without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("rate limited", { status: 429 }),
    );
    const error = await rejection(request(fetch));
    expect(error.kind).toBe("http");
    expect(error.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("times out a slow response", async () => {
    expect((await rejection(request(hanging, 20))).kind).toBe("timeout");
  });

  it("stops waiting when the agent run is aborted", async () => {
    const run = new AbortController();
    const pending = rejection(request(hanging, 2000, run.signal));
    run.abort();
    expect((await pending).kind).toBe("aborted");
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

  it.each([
    ["no answers", {}],
    ["a missing answer", { answers: { irreversible: { type: "noul", noul: 0.1 } } }],
    [
      "an out-of-range answer",
      { answers: { ...goodBody().answers, opaque: { type: "noul", noul: 1.5 } } },
    ],
    [
      "a non-numeric answer",
      { answers: { ...goodBody().answers, requested: { type: "noul", noul: "yes" } } },
    ],
  ])("rejects %s", async (_name, body) => {
    expect((await rejection(request(async () => Response.json(body)))).kind).toBe("malformed");
  });
});

describe("jevModel", () => {
  it("is undefined before Pi 0.99, which has no classifier runtime", () => {
    const old = { find: () => undefined } as unknown as ModelRegistry;
    expect(jevModel(old, DEFAULT_CONFIG)).toBeUndefined();
  });
});
