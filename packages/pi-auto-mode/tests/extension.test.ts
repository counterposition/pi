import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  byId: new Map<string, { registerAuthorizer: ReturnType<typeof vi.fn> }>(),
  importGate: undefined as Promise<void> | undefined,
}));

vi.mock("@gotgenes/pi-permission-system", async () => {
  await services.importGate;
  return { getPermissionsService: (id: string) => services.byId.get(id) };
});

import { QUESTION_IDS } from "../src/questions.js";

const { default: autoMode } = await import("../extensions/auto-mode.js");

type Handler = (...args: unknown[]) => unknown;
type Call = { id: string; command: string };

function fakePi(sessionId = "s1") {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: Handler }>();
  const add = (map: Map<string, Handler[]>, name: string, handler: Handler) =>
    map.set(name, [...(map.get(name) ?? []), handler]);
  const pi = {
    on: (name: string, handler: Handler) => add(handlers, name, handler),
    events: { on: (name: string, handler: Handler) => add(bus, name, handler), emit: vi.fn() },
    registerCommand: (name: string, options: { handler: Handler }) => commands.set(name, options),
    exec: vi.fn(async () => ({
      code: 0,
      stdout: "origin\tgit@github.com:me/repo.git (fetch)\n",
      stderr: "",
      killed: false,
    })),
    getAllTools: () => [],
  };
  const ui = { notify: vi.fn(), setStatus: vi.fn() };
  const branch: unknown[] = [];
  const session = { id: sessionId };
  const ctx = {
    hasUI: true,
    cwd: "/repo",
    ui,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => branch, getSessionId: () => session.id },
  };
  const fire = async (name: string, event: unknown = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  const emit = (name: string, data: unknown) => {
    for (const handler of bus.get(name) ?? []) handler(data);
  };
  /** Appends one assistant message holding these calls, as Pi does before preparing them. */
  const message = (calls: Call[]) =>
    branch.push({
      type: "message",
      message: {
        role: "assistant",
        content: calls.map((c) => ({
          type: "toolCall",
          id: c.id,
          name: "bash",
          arguments: { command: c.command },
        })),
      },
    });
  /** Delivers one prepared call to auto-mode's tool_call handler. */
  const prepare = (call: Call) =>
    fire("tool_call", { toolCallId: call.id, toolName: "bash", input: { command: call.command } });
  autoMode(pi as unknown as ExtensionAPI);
  return {
    fire,
    emit,
    ui,
    session,
    message,
    prepare,
    command: (args: string) => commands.get("auto")!.handler(args, ctx),
  };
}

const service = () => {
  const dispose = vi.fn();
  return { registerAuthorizer: vi.fn((_name: string, _link: unknown) => dispose), dispose };
};

let agentDir: string;

beforeEach(async () => {
  agentDir = await mkdtemp(join(tmpdir(), "auto-mode-ext-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  services.byId.clear();
  services.importGate = undefined;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.PI_CODING_AGENT_DIR;
  await rm(agentDir, { recursive: true, force: true });
});

/** A registered link against a Jev that finds everything safe unless the command says FLAG. */
async function linked(config = '{"apiKey": "test-key"}') {
  await writeFile(join(agentDir, "auto-mode.json"), config);
  const fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const flagged = String(init?.body).includes("FLAG");
    return Response.json({
      model: "jev-1.13.0",
      answers: Object.fromEntries(
        QUESTION_IDS.map((id) => [
          id,
          { type: "noul", noul: flagged && id === "external" ? 0.93 : 0.02 },
        ]),
      ),
    });
  });
  vi.stubGlobal("fetch", fetch);
  const svc = service();
  services.byId.set("s1", svc);
  const pi = fakePi();
  await pi.fire("session_start");
  pi.emit("permissions:ready", { sessionId: "s1" });
  await vi.waitFor(() => expect(svc.registerAuthorizer).toHaveBeenCalled());
  const authorize = svc.registerAuthorizer.mock.calls[0]?.[1] as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const log = { review: vi.fn(), debug: vi.fn() };
  const ask = (call: Call) =>
    authorize(
      {
        requestId: `r-${call.id}`,
        surface: "bash",
        toolCallId: call.id,
        toolName: "bash",
        command: call.command,
      },
      {},
      log,
    );
  return { pi, fetch, ask };
}

describe("auto-mode extension", () => {
  describe("registration", () => {
    it("registers the link once per session and re-registers for a new one", async () => {
      const first = service();
      const second = service();
      services.byId.set("s1", first);
      services.byId.set("s2", second);
      const pi = fakePi("s1");

      await pi.fire("session_start");
      pi.emit("permissions:ready", { sessionId: "s1" });
      pi.emit("permissions:ready", { sessionId: "s1" });
      await vi.waitFor(() => expect(first.registerAuthorizer).toHaveBeenCalledTimes(1));
      expect(first.registerAuthorizer.mock.calls[0]?.[0]).toBe("auto-mode");

      await pi.fire("session_shutdown");
      expect(first.dispose).toHaveBeenCalled();
      pi.session.id = "s2";
      await pi.fire("session_start");
      pi.emit("permissions:ready", { sessionId: "s2" });
      await vi.waitFor(() => expect(second.registerAuthorizer).toHaveBeenCalledTimes(1));
    });

    it("ignores another session's ready on the shared bus", async () => {
      const parent = service();
      const child = service();
      services.byId.set("s1", parent);
      services.byId.set("child", child);
      const pi = fakePi("s1");
      await pi.fire("session_start");
      pi.emit("permissions:ready", { sessionId: "s1" });
      await vi.waitFor(() => expect(parent.registerAuthorizer).toHaveBeenCalled());

      pi.emit("permissions:ready", { sessionId: "child" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(child.registerAuthorizer).not.toHaveBeenCalled();
      expect(parent.dispose).not.toHaveBeenCalled();
    });

    it("registers on the repeat ready when the first came before its own session_start", async () => {
      const svc = service();
      services.byId.set("s1", svc);
      const pi = fakePi();
      pi.emit("permissions:ready", { sessionId: "s1" });
      await pi.fire("session_start");
      pi.emit("permissions:ready", { sessionId: "s1" });
      await vi.waitFor(() => expect(svc.registerAuthorizer).toHaveBeenCalledTimes(1));
    });

    it("does not register a stale link after shutdown", async () => {
      let release: () => void = () => {};
      services.importGate = new Promise<void>((resolve) => (release = resolve));
      const svc = service();
      services.byId.set("s1", svc);
      const pi = fakePi();

      await pi.fire("session_start");
      pi.emit("permissions:ready", { sessionId: "s1" });
      await pi.fire("session_shutdown");
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(svc.registerAuthorizer).not.toHaveBeenCalled();
    });
  });

  it("clears a flagged call's status when its permission decision lands", async () => {
    const { pi, ask } = await linked();
    const call = { id: "c1", command: "git push FLAG" };
    pi.message([call]);
    await pi.prepare(call);
    expect(await ask(call)).toEqual({ kind: "defer" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith(
      "auto-mode",
      "auto: asking you: changes something outside this machine",
    );

    pi.emit("permissions:decision", { result: "deny" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto");

    await pi.command("off");
    pi.ui.setStatus.mockClear();
    expect(await ask(call)).toEqual({ kind: "defer" });
    expect(pi.ui.setStatus).not.toHaveBeenCalled();
  });

  describe("capture trust", () => {
    it("judges the prepared call when it sees the call first", async () => {
      const { pi, fetch, ask } = await linked();
      const call = { id: "c1", command: "echo ok" };
      pi.message([call]);
      await pi.prepare(call);
      expect(await ask(call)).toEqual({ kind: "allow" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("never uses a capture that another call with the same id may have left", async () => {
      const { pi, fetch, ask } = await linked();
      // Gate first: a policy-allowed `git status` reaches auto-mode, then an ask reuses its id.
      const allowed = { id: "dup", command: "git status" };
      const risky = { id: "dup", command: "git push --force origin main" };
      pi.message([allowed, risky]);
      await pi.prepare(allowed);
      expect(await ask(risky)).toEqual({ kind: "defer" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("defers an ask whose call it has not seen, and says why at once", async () => {
      const { pi, fetch, ask } = await linked();
      const call = { id: "c1", command: "echo ok" };
      pi.message([call]);
      // The gate asks before this extension sees the call; the user then declines, so it never will.
      expect(await ask(call)).toEqual({ kind: "defer" });
      expect(pi.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("loaded too late"),
        "warning",
      );
      expect(fetch).not.toHaveBeenCalled();
      await pi.command("status");
      expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain(
        "loaded after the permission system",
      );
    });

    it("does not blame load order for a subagent's forwarded call", async () => {
      const { pi, ask } = await linked();
      expect(await ask({ id: "child-call", command: "echo ok" })).toEqual({ kind: "defer" });
      expect(pi.ui.notify).not.toHaveBeenCalledWith(
        expect.stringContaining("loaded too late"),
        "warning",
      );
    });

    it("defers a repeated id without disabling later calls", async () => {
      const { pi, fetch, ask } = await linked();
      const a = { id: "dup", command: "git status" };
      const b = { id: "dup", command: "git push --force origin main" };
      pi.message([a, b]);
      await pi.prepare(a);
      await pi.prepare(b);
      expect(await ask(b)).toEqual({ kind: "defer" });
      expect(fetch).not.toHaveBeenCalled();

      const fresh = { id: "fresh", command: "echo ok" };
      pi.message([fresh]);
      await pi.prepare(fresh);
      expect(await ask(fresh)).toEqual({ kind: "allow" });
      expect(pi.ui.notify).not.toHaveBeenCalledWith(
        expect.stringContaining("loaded too late"),
        "warning",
      );
    });
  });

  it("says once when TypeSafe rejects the key, and recovers when it works again", async () => {
    const { pi, ask } = await linked();
    const ok = vi.mocked(fetch).getMockImplementation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );
    for (const id of ["r1", "r2"]) {
      const call = { id, command: "echo ok" };
      pi.message([call]);
      await pi.prepare(call);
      expect(await ask(call)).toEqual({ kind: "defer" });
    }
    const warnings = pi.ui.notify.mock.calls.filter(([m]) => String(m).includes("rejected"));
    expect(warnings).toHaveLength(1);
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith(
      "auto-mode",
      "auto: asking you: Jev didn't answer",
    );
    pi.emit("permissions:decision", { result: "deny" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto: needs setup (/auto)");
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("rejected the API key");

    // Another kind of failure says nothing about the key.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const down = { id: "r2b", command: "echo ok" };
    pi.message([down]);
    await pi.prepare(down);
    expect(await ask(down)).toEqual({ kind: "defer" });
    pi.emit("permissions:decision", { result: "deny" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto: needs setup (/auto)");

    vi.stubGlobal("fetch", vi.fn(ok));
    const call = { id: "r3", command: "echo ok" };
    pi.message([call]);
    await pi.prepare(call);
    expect(await ask(call)).toEqual({ kind: "allow" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto");
  });

  it("says when the permission system is missing, at the first tool call", async () => {
    await writeFile(join(agentDir, "auto-mode.json"), '{"apiKey": "test-key"}');
    const pi = fakePi();
    await pi.fire("session_start");
    await pi.prepare({ id: "c1", command: "echo ok" });
    expect(pi.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("isn't connected to the permission system"),
      "warning",
    );
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("Needs setup");
  });

  it("checks the key when turned on from an off config", async () => {
    const { pi } = await linked('{"mode": "off", "apiKey": "$PI_AUTO_MODE_TEST_UNSET_KEY"}');
    await pi.command("on");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("no TypeSafe API key");
  });

  it("notices a key added during the session", async () => {
    const { pi } = await linked('{"apiKey": "$PI_AUTO_MODE_TEST_LATE_KEY"}');
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("no TypeSafe API key");
    vi.stubEnv("PI_AUTO_MODE_TEST_LATE_KEY", "late-key");
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).not.toContain("no TypeSafe API key");
    vi.unstubAllEnvs();
  });

  it("reports a missing key in /auto before any ask", async () => {
    const { pi } = await linked('{"apiKey": "$PI_AUTO_MODE_TEST_UNSET_KEY"}');
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("no TypeSafe API key");
  });

  it("says once, with the fix, when it has no API key", async () => {
    const { pi, fetch, ask } = await linked('{"apiKey": "$PI_AUTO_MODE_TEST_UNSET_KEY"}');
    for (const id of ["k1", "k2"]) {
      const call = { id, command: "echo ok" };
      pi.message([call]);
      await pi.prepare(call);
      expect(await ask(call)).toEqual({ kind: "defer" });
    }
    const warnings = pi.ui.notify.mock.calls.filter(([m]) =>
      String(m).includes("TYPESAFE_API_KEY"),
    );
    expect(warnings).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says once, with the fix, when asks reach the user without passing through it", async () => {
    const { pi, ask } = await linked();
    const decision = (requestId: string) => ({
      requestId,
      result: "allow",
      resolution: "user_approved",
      forwarding: null,
    });
    pi.emit("permissions:decision", decision("never-seen"));
    pi.emit("permissions:decision", decision("again"));
    const warnings = pi.ui.notify.mock.calls.filter(([m]) => String(m).includes("authorizerChain"));
    expect(warnings).toHaveLength(1);
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto: needs setup (/auto)");
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("Needs setup");

    // Once the chain is fixed, the link is consulted again and the warning clears.
    const call = { id: "fixed", command: "echo ok" };
    pi.message([call]);
    await pi.prepare(call);
    expect(await ask(call)).toEqual({ kind: "allow" });
    expect(pi.ui.setStatus).toHaveBeenLastCalledWith("auto-mode", "auto");
  });

  it("says chain use is unconfirmed until the permission system first asks it", async () => {
    const { pi, ask } = await linked();
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).toContain("Not confirmed yet");

    const call = { id: "first", command: "echo ok" };
    pi.message([call]);
    await pi.prepare(call);
    await ask(call);
    await pi.command("status");
    expect(String(pi.ui.notify.mock.calls.at(-1)?.[0])).not.toContain("Not confirmed");
  });

  it("tells the agent about auto mode only while it is on and linked", async () => {
    const { pi } = await linked();
    const event = () => ({ systemPromptOptions: { sections: {} as Record<string, string> } });
    const on = event();
    await pi.fire("before_agent_start", on);
    expect(on.systemPromptOptions.sections["auto-mode"]).toContain("it did not run");

    await pi.command("off");
    const off = event();
    await pi.fire("before_agent_start", off);
    expect(off.systemPromptOptions.sections["auto-mode"]).toBeUndefined();
  });

  it("reports status, trusted remotes, and a bad config", async () => {
    await writeFile(join(agentDir, "auto-mode.json"), '{"mode": "yolo"}');
    const pi = fakePi();
    await pi.fire("session_start");
    expect(pi.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Auto mode is off"),
      "warning",
    );
    await pi.command("status");
    const status = String(pi.ui.notify.mock.calls.at(-1)?.[0]);
    expect(status).toContain("Auto mode is off");
    expect(status).toContain("github.com/me/repo");
    expect(status).toContain("config error");
  });
});
