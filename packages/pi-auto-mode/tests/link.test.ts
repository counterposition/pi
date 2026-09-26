import type { AuthorizerLog, PromptPermissionDetails } from "@gotgenes/pi-permission-system";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config.js";
import type { Mode } from "../src/config.js";
import { authorize } from "../src/link.js";
import type { LinkContext } from "../src/link.js";
import { QUESTION_IDS } from "../src/questions.js";
import { MAX_USER_MESSAGE_CHARS } from "../src/state.js";
import type { Answers } from "../src/questions.js";

const details = {
  requestId: "req-1",
  surface: "bash",
  toolCallId: "call-1",
  toolName: "bash",
  command: "git push origin main",
} as PromptPermissionDetails;

const jevBody = (overrides: Partial<Answers> = {}) => ({
  model: "jev-1.13.0",
  answers: Object.fromEntries(
    QUESTION_IDS.map((id) => [id, { type: "noul", noul: overrides[id] ?? 0.05 }]),
  ),
});
const jevReturning = (overrides: Partial<Answers> = {}) =>
  vi.fn<typeof fetch>(async () => Response.json(jevBody(overrides)));

const pushBranch = [
  { type: "message", message: { role: "user", content: "commit and push" } },
  {
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "git push origin main" },
        },
      ],
    },
  },
];

const setup = (overrides: Partial<LinkContext> = {}) => {
  const log = { review: vi.fn(), debug: vi.fn() } satisfies AuthorizerLog;
  const ctx: LinkContext = {
    mode: () => "on",
    isCurrent: () => true,
    pendingInput: () => false,
    config: DEFAULT_CONFIG,
    hasUI: true,
    cwd: "/repo",
    environment: [],
    branch: () => pushBranch,
    prepared: () => ({ toolName: "bash", input: { command: "git push origin main" } }),
    tools: () => [],
    apiKey: async () => "key",
    setStatus: vi.fn(),
    fetch: jevReturning(),
    ...overrides,
  };
  return { ctx, log, run: (d: PromptPermissionDetails = details) => authorize(d, ctx, log) };
};

const lastReview = (log: { review: ReturnType<typeof vi.fn> }) =>
  log.review.mock.calls.at(-1) as [string, Record<string, unknown>];

describe("authorize", () => {
  it("defers path and outside-project asks without sending them to Jev", async () => {
    for (const surface of ["path", "external_directory", "external_directory_write", undefined]) {
      const { ctx, run } = setup();
      expect(await run({ ...details, surface } as PromptPermissionDetails)).toEqual({
        kind: "defer",
      });
      expect(ctx.fetch).not.toHaveBeenCalled();
    }
  });

  it("defers without calling Jev when auto mode is off", async () => {
    const { ctx, run } = setup({ mode: () => "off" });
    expect(await run()).toEqual({ kind: "defer" });
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it("allows a safe call and records the verdict trail", async () => {
    const { ctx, log, run } = setup();
    expect(await run()).toEqual({ kind: "allow" });

    const body = JSON.parse(String(vi.mocked(ctx.fetch!).mock.calls[0]?.[1]?.body)) as {
      state: { user_messages: string[]; action: unknown };
    };
    expect(body.state.user_messages).toEqual(["commit and push"]);
    expect(body.state.action).toEqual({ tool: "bash", input: { command: "git push origin main" } });

    const [event, entry] = lastReview(log);
    expect(event).toBe("auto_mode_verdict");
    expect(entry).toMatchObject({ requestId: "req-1", verdict: "allow", model: "jev-1.13.0" });
    expect(entry.probabilities).toMatchObject({ external: 0.05 });
  });

  it("defers a flagged call to the dialog with the hazard in the status line", async () => {
    const { ctx, log, run } = setup({ fetch: jevReturning({ external: 0.93 }) });
    expect(await run()).toEqual({ kind: "defer" });
    expect(ctx.setStatus).toHaveBeenCalledWith(
      "asking you: changes something outside this machine",
    );
    expect(lastReview(log)[1]).toMatchObject({ verdict: "defer", hazard: "external" });
  });

  it("denies a flagged call headless with a reason the model reads", async () => {
    const { ctx, run } = setup({ hasUI: false, fetch: jevReturning({ irreversible: 0.9 }) });
    const verdict = await run();
    expect(verdict.kind).toBe("deny");
    expect(verdict.kind === "deny" && verdict.reason).toContain("irreversible 0.90");
    expect(ctx.setStatus).not.toHaveBeenCalled();
  });

  it("only observes in shadow mode", async () => {
    const { log, run } = setup({
      mode: () => "shadow",
      fetch: jevReturning({ irreversible: 0.9 }),
    });
    expect(await run()).toEqual({ kind: "defer" });
    expect(lastReview(log)[1]).toMatchObject({ why: "shadow", wouldBe: "defer" });
  });

  it.each<[Mode, string | undefined]>([
    ["off", undefined],
    ["shadow", "shadow"],
  ])("honors /auto %s issued while Jev is answering", async (next, why) => {
    let mode: Mode = "on";
    let answer: (response: Response) => void = () => {};
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const { log, run } = setup({ mode: () => mode, fetch });
    const pending = run();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    mode = next;
    answer(Response.json(jevBody()));
    expect(await pending).toEqual({ kind: "defer" });
    expect((log.review.mock.calls.at(-1)?.[1] as { why?: string } | undefined)?.why).toBe(why);
  });

  it("allows nothing while the user has a message waiting", async () => {
    const waiting = setup({ pendingInput: () => true });
    expect(await waiting.run()).toEqual({ kind: "defer" });
    expect(waiting.ctx.fetch).not.toHaveBeenCalled();
    expect(lastReview(waiting.log)[1]).toMatchObject({ why: "pending" });

    // The user steers ("Stop. Do not push.") while Jev is answering.
    let pending = false;
    const steered = setup({
      pendingInput: () => pending,
      fetch: vi.fn<typeof fetch>(async () => {
        pending = true;
        return Response.json(jevBody());
      }),
    });
    expect(await steered.run()).toEqual({ kind: "defer" });
    expect(lastReview(steered.log)[1]).toMatchObject({ why: "pending" });
  });

  it("defers when the session was replaced while Jev was answering", async () => {
    let current = true;
    const { log, run } = setup({
      isCurrent: () => current,
      fetch: vi.fn<typeof fetch>(async () => {
        current = false;
        return Response.json(jevBody());
      }),
    });
    expect(await run()).toEqual({ kind: "defer" });
    expect(lastReview(log)[1]).toMatchObject({ why: "stale" });
  });

  it("sends a call to a human, without asking Jev, when user text was cut", async () => {
    const long = {
      type: "message",
      message: {
        role: "user",
        content: `Do not run the tests. ${"x".repeat(MAX_USER_MESSAGE_CHARS)}`,
      },
    };
    const { ctx, log, run } = setup({ branch: () => [long, ...pushBranch] });
    expect(await run()).toEqual({ kind: "defer" });
    expect(ctx.fetch).not.toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith("asking you: too long for Jev to read");
    expect(lastReview(log)[1]).toMatchObject({ why: "incomplete" });
  });

  it("defers an ask it cannot tie to one prepared call", async () => {
    const { ctx, log, run } = setup({
      prepared: (id) =>
        id === "call-1"
          ? { toolName: "bash", input: { command: "git push origin main" } }
          : id === "dup"
            ? "duplicate"
            : undefined,
    });
    expect(await run({ ...details, toolCallId: "missing" })).toEqual({ kind: "defer" });
    expect(await run({ ...details, toolCallId: "dup" })).toEqual({ kind: "defer" });
    expect(await run({ ...details, toolName: "slack_post" })).toEqual({ kind: "defer" });
    const forwarding = { requesterAgentName: null, requesterSessionId: null };
    expect(await run({ ...details, forwarding })).toEqual({ kind: "defer" });
    expect(ctx.fetch).not.toHaveBeenCalled();
    expect(log.review.mock.calls.map(([, e]) => (e as { why: string }).why)).toEqual([
      "unverified",
      "ambiguous",
      "mismatch",
      "forwarded",
    ]);
  });

  it("sends a never-auto-allowed command to a human without asking Jev", async () => {
    const cron = { toolName: "bash", input: { command: "crontab -e" } };
    const ui = setup({ prepared: () => cron });
    expect(await ui.run({ ...details, command: "crontab -e" })).toEqual({ kind: "defer" });
    expect(ui.ctx.setStatus).toHaveBeenCalledWith("asking you: changes scheduled jobs");
    expect(ui.ctx.fetch).not.toHaveBeenCalled();

    const headless = setup({ hasUI: false, prepared: () => cron });
    const verdict = await headless.run({ ...details, command: "crontab -e" });
    expect(verdict.kind === "deny" && verdict.reason).toContain("changes scheduled jobs");
    expect(headless.ctx.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "at + 1 minute",
    "curl --proxy-insecure --proxy https://proxy.example https://x.dev",
    "ssh -o StrictHostKeyChecking=false example.com true",
    "brew services start postgresql@17",
    "brew services --verbose start redis",
    "brew services --file dev.plist start redis",
    'brew services --file "dev file.plist" start redis',
    "printf 'echo later\\n' | at Monday",
    "printf 'echo later\\n' | at next minute",
  ])("sends %s to a human without asking Jev", async (command) => {
    const call = { toolName: "bash", input: { command } };
    const ui = setup({ prepared: () => call });
    expect(await ui.run({ ...details, command })).toEqual({ kind: "defer" });
    expect(ui.ctx.fetch).not.toHaveBeenCalled();
    const headless = setup({ hasUI: false, prepared: () => call });
    expect((await headless.run({ ...details, command })).kind).toBe("deny");
    expect(headless.ctx.fetch).not.toHaveBeenCalled();
  });

  it("defers when Jev fails", async () => {
    const { log, run } = setup({
      fetch: vi.fn<typeof fetch>(async () => new Response("down", { status: 503 })),
    });
    expect(await run()).toEqual({ kind: "defer" });
    expect(lastReview(log)[1]).toMatchObject({ why: "error", error: "http", status: 503 });
  });

  it("defers without a key", async () => {
    const { ctx, log, run } = setup({ apiKey: async () => undefined });
    expect(await run()).toEqual({ kind: "defer" });
    expect(ctx.fetch).not.toHaveBeenCalled();
    expect(lastReview(log)[1]).toMatchObject({ why: "no_api_key" });
  });

  it("defers instead of throwing when a collaborator fails", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    for (const overrides of [
      { branch: boom },
      { apiKey: async () => boom() },
      { setStatus: boom, fetch: jevReturning({ opaque: 0.9 }) },
    ] satisfies Partial<LinkContext>[]) {
      expect(await setup(overrides).run()).toEqual({ kind: "defer" });
    }
  });

  it("still returns a verdict when the review log throws", async () => {
    const { ctx } = setup();
    const log = {
      review: vi.fn(() => {
        throw new Error("disk full");
      }),
      debug: vi.fn(),
    };
    expect(await authorize(details, ctx, log)).toEqual({ kind: "allow" });
  });

  it("sends oversized actions to a human without calling Jev", async () => {
    const huge = "echo ok; ".repeat(3000) + "rm -rf ~";
    const { ctx, log, run } = setup({
      prepared: () => ({ toolName: "bash", input: { command: huge } }),
    });
    expect(await run({ ...details, command: "rm -rf ~" })).toEqual({ kind: "defer" });
    expect(ctx.fetch).not.toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith("asking you: too long for Jev to read");
    expect(lastReview(log)[1]).toMatchObject({ why: "oversized" });
  });
});
