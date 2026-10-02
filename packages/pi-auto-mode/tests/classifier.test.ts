import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askClassifier, ClassifierError, findClassifier, parseModel } from "../src/classifier.js";
import type { Classifier } from "../src/classifier.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { QUESTION_IDS } from "../src/questions.js";
import type { ClassifierState } from "../src/state.js";
import { testModels } from "./fixtures/models.js";

const state: ClassifierState = {
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

const hanging: typeof globalThis.fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

let models: ModelRegistry;
let model: Classifier;

beforeEach(async () => {
  process.env.TYPESAFE_API_KEY = "k";
  models = await testModels();
  const found = await findClassifier(models, DEFAULT_CONFIG.model);
  if ("problem" in found) throw new Error(found.problem);
  model = found;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TYPESAFE_API_KEY;
});

const request = (fetch: typeof globalThis.fetch, timeoutMs = 2000, signal?: AbortSignal) => {
  vi.stubGlobal("fetch", fetch);
  return askClassifier({ models, model, state, timeoutMs, signal });
};

const rejection = async (promise: Promise<unknown>): Promise<ClassifierError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ClassifierError);
  return error as ClassifierError;
};

describe("parseModel", () => {
  it("splits at the first slash, since IDs may contain slashes", () => {
    expect(parseModel("openrouter/typesafe/jev-1.13")).toEqual({
      provider: "openrouter",
      id: "typesafe/jev-1.13",
    });
    expect(parseModel("jev-1.13.0")).toBeUndefined();
    expect(parseModel("/jev")).toBeUndefined();
    expect(parseModel("typesafe/")).toBeUndefined();
  });
});

describe("findClassifier", () => {
  it("says when Pi has no such model", async () => {
    expect(await findClassifier(models, "typesafe/jev-0.1")).toEqual({
      problem: "Pi has no classifier model 'typesafe/jev-0.1'",
    });
  });

  it("says when the provider has no credentials", async () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(await findClassifier(models, "typesafe/jev-latest")).toEqual({
      problem: "no typesafe credentials for typesafe/jev-latest",
    });
  });
});

describe("askClassifier", () => {
  it("asks once through Pi with the provider's key and returns validated answers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(goodBody()));
    const result = await request(fetch);

    expect(result.answers.requested).toBe(0.1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer k");
    const body = JSON.parse(String(init?.body)) as { state: unknown; questions: object };
    expect(body.state).toEqual(state);
    expect(Object.keys(body.questions)).toEqual(QUESTION_IDS);
  });

  it("reports HTTP errors with their status, without retrying", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("rate limited", { status: 429 }),
    );
    const error = await rejection(request(fetch));
    expect(error.kind).toBe("failed");
    expect(error.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("times out a slow response", async () => {
    expect((await rejection(request(hanging, 20))).kind).toBe("timeout");
  });

  it("stops waiting when the agent run is aborted", async () => {
    const run = new AbortController();
    const pending = request(hanging, 2000, run.signal);
    run.abort();
    expect((await rejection(pending)).kind).toBe("aborted");
  });

  it.each([
    ["a missing answer", { answers: { irreversible: { type: "noul", noul: 0.1 } } }],
    [
      "an out-of-range answer",
      { answers: { ...goodBody().answers, opaque: { type: "noul", noul: 1.5 } } },
    ],
  ])("rejects %s", async (_name, body) => {
    const error = await rejection(request(async () => Response.json(body)));
    expect(["failed", "malformed"]).toContain(error.kind);
  });
});
