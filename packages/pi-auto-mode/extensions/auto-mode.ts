import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  PermissionDecisionEvent,
  PermissionsReadyEvent,
} from "@gotgenes/pi-permission-system";

import { findClassifier } from "../src/classifier.js";
import type { Classifier } from "../src/classifier.js";
import { DEFAULT_CONFIG, loadConfig, MODES } from "../src/config.js";
import type { LoadedConfig, Mode } from "../src/config.js";
import { authorize, LINK_NAME } from "../src/link.js";
import type { LinkContext } from "../src/link.js";
import { callsWithId, parseRemotes, remotesEnvironment } from "../src/state.js";
import type { PreparedCall } from "../src/state.js";

const STATUS_KEY = "auto-mode";
const CHAIN_FIX =
  'add "authorizerChain": ["auto-mode"] to ~/.pi/agent/extensions/pi-permission-system/config.json';
const UNCONFIRMED = `Not confirmed yet: nothing has needed permission since Pi started. If the first ask ever skips auto mode, you'll be told to ${CHAIN_FIX}.`;
const MODEL_FIX =
  "give Pi the provider's credentials (/login, or its API key variable such as TYPESAFE_API_KEY), or set model in ~/.pi/agent/auto-mode.json";
const ORDER_FIX =
  "list @counterposition/pi-auto-mode before @gotgenes/pi-permission-system in your Pi packages";

const GUIDANCE = `## Auto mode

A classifier reviews tool calls that would otherwise need the user's permission and lets routine ones run without asking. Do the work the user asked for directly; do not ask permission for routine development steps.

If a tool call is blocked or denied, it did not run. Do not retry it, work around it, or rely on its effects. Tell the user what you wanted to do and why, then continue with work that does not depend on it. Never change auto-mode, permission, or Pi configuration to get past a block.`;

const SUMMARY: Record<Mode, string> = {
  on: "Routine calls run without asking you; risky ones still ask.",
  shadow: "Every call still asks you; the classifier's verdicts are only logged.",
  off: "Every permission ask comes to you.",
};

export default function autoMode(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let loaded: LoadedConfig = { config: { ...DEFAULT_CONFIG, mode: "off" }, errors: [] };
  let sessionMode: Mode | undefined;
  let remotes: string[] = [];
  /** Bumped on every session start and shutdown; a pending verdict checks it before acting. */
  let generation = 0;
  /** Bumped on shutdown only: ready can fire before this extension's own session_start. */
  let shutdowns = 0;
  let registration: { sessionId: string; dispose?: () => void; error?: string } | undefined;
  /** Setup problems already reported this process, so each is said once. */
  const warned = new Set<string>();
  /** Asks this link was consulted on, to spot asks that bypass it. */
  const consulted = new Set<string>();
  /** Why the configured classifier cannot be used, while it cannot. */
  let classifierProblem: string | undefined;
  /** The last classifier failure, until a request works again. */
  let classifierFailure: string | undefined;
  let notInChain = false;
  /** Set once the permission system has consulted this link, proving it is in the chain. */
  let confirmed = false;
  /**
   * Calls still running in this session, as the `tool_call` event carried them. Pi runs
   * handlers in load order, so this sees a call before the permission gate only if
   * auto-mode loads first; `resolveState` trusts a capture only when it ties to exactly
   * one call in the transcript, so a late load costs prompts, never safety.
   */
  const running = new Map<string, PreparedCall | "duplicate">();
  let loadsLate = false;

  const mode = (): Mode => sessionMode ?? loaded.config.mode;

  const checkOrder = (toolCallId: string | undefined) => {
    if (toolCallId === undefined || running.has(toolCallId) || loadsLate || !ctx) return;
    // A call on this session's own branch that the tool_call handler has not seen can
    // only mean the gate ran first: this extension loaded after the permission system.
    if (callsWithId(ctx.sessionManager.getBranch(), toolCallId).length > 0) {
      loadsLate = true;
      warn(
        "order",
        `Auto mode loaded too late to check calls, so they all come to you. To fix: ${ORDER_FIX}.`,
      );
    }
  };

  const warn = (problem: string, message: string) => {
    if (warned.has(problem)) return;
    warned.add(problem);
    ctx?.ui.notify(message, "warning");
  };
  const problems = (): string[] => [
    ...loaded.errors.map((error) => `config error: ${error}`),
    ...(!registration?.dispose
      ? [
          `not connected to the permission system (${registration?.error ?? "is @gotgenes/pi-permission-system installed?"})`,
        ]
      : []),
    ...(notInChain ? [`not in the permission system's chain: ${CHAIN_FIX}`] : []),
    ...(classifierProblem ? [`${classifierProblem}: ${MODEL_FIX}`] : []),
    ...(classifierFailure ? [`the classifier failed: ${classifierFailure}`] : []),
    ...(loadsLate ? [`loaded after the permission system: ${ORDER_FIX}`] : []),
  ];
  /** "auto" while on; "auto: asking you: ..." while a call waits for the user. */
  const setStatus = (label: string | undefined) => {
    if (!ctx?.hasUI) return;
    const base =
      mode() === "off"
        ? undefined
        : problems().length > 0
          ? "auto: needs setup (/auto)"
          : mode() === "shadow"
            ? "auto: shadow"
            : "auto";
    ctx.ui.setStatus(STATUS_KEY, label && base ? `auto: ${label}` : base);
  };
  const clearStatus = () => setStatus(undefined);
  const checkClassifier = async (): Promise<Classifier | undefined> => {
    if (!ctx) return undefined;
    const found = await findClassifier(ctx.modelRegistry, loaded.config.model);
    const problem = "problem" in found ? found.problem : undefined;
    if (problem !== classifierProblem) {
      classifierProblem = problem;
      if (problem) {
        warned.delete("classifier");
        warn(
          "classifier",
          `Auto mode can't use the classifier (${problem}), so every ask comes to you. To fix: ${MODEL_FIX}.`,
        );
      }
      clearStatus();
    }
    return "problem" in found ? undefined : found;
  };

  const linkContext = (): LinkContext | undefined => {
    const current = ctx;
    if (!current) return undefined;
    const born = generation;
    return {
      mode,
      isCurrent: () => generation === born,
      pendingInput: () => current.hasPendingMessages(),
      config: loaded.config,
      hasUI: current.hasUI,
      cwd: current.cwd,
      environment: [...loaded.config.environment, ...remotesEnvironment(remotes)],
      branch: () => current.sessionManager.getBranch(),
      prepared: (toolCallId) => (generation === born ? running.get(toolCallId) : undefined),
      tools: () => pi.getAllTools(),
      models: current.modelRegistry,
      classifier: checkClassifier,
      signal: () => current.signal,
      setStatus,
      classifierResult: (error) => {
        // A slow answer or a stopped run says nothing about the setup.
        if (error?.kind === "timeout" || error?.kind === "aborted") return;
        const failure = error?.message;
        if (failure && !classifierFailure) {
          warn(
            "failed",
            `Auto mode's classifier failed (${failure}), so asks come to you until it works.`,
          );
        }
        if (failure !== classifierFailure) {
          classifierFailure = failure;
          if (!failure) warned.delete("failed");
          clearStatus();
        }
      },
    };
  };

  const register = async (sessionId: string) => {
    const born = shutdowns;
    const attempt: NonNullable<typeof registration> = { sessionId };
    registration = attempt;
    try {
      const { getPermissionsService } = await import("@gotgenes/pi-permission-system");
      if (shutdowns !== born || registration !== attempt) return;
      const service = getPermissionsService(sessionId);
      if (!service) {
        attempt.error = "the permission system has no service for this session";
        clearStatus();
        return;
      }
      attempt.dispose = service.registerAuthorizer(LINK_NAME, async (details, _query, log) => {
        consulted.add(details.requestId);
        confirmed = true;
        // Being consulted proves the link is in the chain, so a fixed config clears it.
        if (notInChain) {
          notInChain = false;
          warned.delete("chain");
          clearStatus();
        }
        if (mode() !== "off") checkOrder(details.toolCallId);
        const link = linkContext();
        return link ? authorize(details, link, log) : { kind: "defer" };
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      attempt.error = err.message;
      warn("register", `Auto mode couldn't connect to the permission system: ${err.message}`);
    }
    clearStatus();
  };

  pi.on("session_start", async (_event, c) => {
    generation++;
    running.clear();
    ctx = c;
    sessionMode = undefined;
    loaded = await loadConfig(join(getAgentDir(), "auto-mode.json"));
    if (loaded.errors.length > 0) {
      c.ui.notify(`Auto mode is off: ${loaded.errors.join("; ")}`, "warning");
    }
    classifierFailure = undefined;
    if (loaded.config.mode !== "off") void checkClassifier();
    const result = await pi.exec("git", ["remote", "-v"], { cwd: c.cwd, timeout: 5000 });
    remotes = result.code === 0 ? parseRemotes(result.stdout) : [];
  });

  pi.events.on("permissions:ready", (data) => {
    const { sessionId } = data as PermissionsReadyEvent;
    // The bus is shared with in-process subagent sessions: register only for this one.
    // Ready repeats at before_agent_start, after this extension's session_start.
    if (!sessionId || sessionId !== ctx?.sessionManager.getSessionId()) return;
    if (registration?.sessionId === sessionId) return;
    registration?.dispose?.();
    void register(sessionId);
  });

  pi.on("before_agent_start", (event) => {
    if (mode() !== "on" || !registration?.dispose) return;
    event.systemPromptOptions.sections[STATUS_KEY] = GUIDANCE;
  });

  pi.on("tool_call", (event) => {
    // By the first tool call the permission system has announced itself, if it is here.
    if (mode() !== "off" && !registration) {
      warn(
        "absent",
        "Auto mode isn't connected to the permission system, so it isn't checking anything. To fix: install @gotgenes/pi-permission-system (see /auto).",
      );
      clearStatus();
    }
    // Keep the live input object: the gate and the tool read this same object.
    running.set(
      event.toolCallId,
      running.has(event.toolCallId)
        ? "duplicate"
        : {
            toolName: event.toolName,
            input: event.input as Record<string, unknown>,
            parentToolCallId: event.parentToolCallId,
          },
    );
  });

  // A denied call never reaches tool_result, so clear on the decision itself too.
  pi.events.on("permissions:decision", (data) => {
    clearStatus();
    const decision = data as PermissionDecisionEvent;
    const byUser = String(decision.resolution).startsWith("user_");
    // You were asked about a call this link never saw: it is not in the chain.
    if (
      byUser &&
      !decision.forwarding &&
      mode() !== "off" &&
      registration?.dispose &&
      !consulted.has(decision.requestId) &&
      !notInChain
    ) {
      notInChain = true;
      warn("chain", `Auto mode isn't checking your permission asks yet. To fix: ${CHAIN_FIX}.`);
      clearStatus();
    }
    consulted.delete(decision.requestId);
  });
  pi.on("tool_result", (event) => {
    clearStatus();
    running.delete(event.toolCallId);
  });
  // A blocked call has no tool_result, but every call, nested or not, ends.
  pi.on("tool_execution_end", (event) => {
    running.delete(event.toolCallId);
  });
  pi.on("agent_end", () => {
    clearStatus();
    running.clear();
  });

  pi.on("session_shutdown", () => {
    generation++;
    shutdowns++;
    clearStatus();
    registration?.dispose?.();
    registration = undefined;
    running.clear();
    ctx = undefined;
  });

  pi.registerCommand("auto", {
    description: "Auto mode: /auto on | off | shadow, or /auto for status",
    getArgumentCompletions: (prefix) =>
      [...MODES, "status"]
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value })),
    handler: async (args, c) => {
      const arg = args.trim();
      if ((MODES as readonly string[]).includes(arg)) {
        sessionMode = arg as Mode;
        if (arg !== "off") await checkClassifier();
        clearStatus();
        const issues = arg === "off" ? [] : problems();
        c.ui.notify(
          [
            `Auto mode is ${arg} for this session. ${SUMMARY[arg as Mode]}`,
            ...(issues.length > 0 ? ["", "Needs setup:", ...issues.map((i) => `- ${i}`)] : []),
          ].join("\n"),
          issues.length > 0 ? "warning" : "info",
        );
        return;
      }
      if (arg !== "" && arg !== "status") {
        c.ui.notify("Usage: /auto on | off | shadow, or /auto for status", "error");
        return;
      }
      const { config } = loaded;
      if (mode() !== "off") await checkClassifier();
      const issues = mode() === "off" ? loaded.errors.map((e) => `config error: ${e}`) : problems();
      const lines = [
        `Auto mode is ${mode()}${sessionMode ? " for this session" : ""}. ${SUMMARY[mode()]}`,
        ...(issues.length > 0 ? ["", "Needs setup:", ...issues.map((issue) => `- ${issue}`)] : []),
        ...(mode() !== "off" && issues.length === 0 && !confirmed ? [UNCONFIRMED] : []),
        "",
        `Trusted git remotes: ${remotes.join(", ") || "none"}`,
        `Classifier ${config.model}, timeout ${config.timeoutMs} ms, thresholds safe ${config.thresholds.safe} / intent ${config.thresholds.intent} / hard ${config.thresholds.hard}`,
      ];
      c.ui.notify(lines.join("\n"), issues.length > 0 ? "warning" : "info");
    },
  });
}
