import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  AuthorizerLog,
  AuthorizerVerdict,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";

import type { AutoModeConfig, Mode } from "./config.js";
import { askJev, JevError, jevModel } from "./jev.js";
import { flagText, route } from "./route.js";
import { neverAutoAllow } from "./never.js";
import { isOversized, resolveAction, resolveState } from "./state.js";
import type { BranchEntry, PreparedLookup, ToolDescription, Unresolved } from "./state.js";

export const LINK_NAME = "auto-mode";

export interface LinkContext {
  /** Read live: `/auto` can change it while a Jev request is in flight. */
  mode(): Mode;
  /** False once the session this context was built for has been replaced. */
  isCurrent(): boolean;
  /**
   * True while the user has typed a message Pi has queued but not yet added to the
   * branch: it may narrow or revoke what they asked, so nothing is allowed until it lands.
   */
  pendingInput(): boolean;
  config: AutoModeConfig;
  hasUI: boolean;
  cwd: string;
  /** Config prose plus the trusted-remotes entry. */
  environment: readonly string[];
  branch(): readonly BranchEntry[];
  /**
   * The still-running call Pi's `tool_call` event carried for this id in this session,
   * if this extension saw it first.
   */
  prepared: PreparedLookup;
  tools(): readonly ToolDescription[];
  apiKey(): Promise<string | undefined>;
  /** Pi's model registry, which runs the Jev request. */
  models: ModelRegistry;
  /** The agent run's abort signal, if it is running. */
  signal(): AbortSignal | undefined;
  /** Shows a flagged call's hazard next to the approval dialog. */
  setStatus(label: string | undefined): void;
  /** Told whether each Jev request worked, so setup problems (a rejected key) can surface. */
  jevResult?(error: JevError | undefined): void;
  fetch?: typeof fetch;
}

type Why =
  | Unresolved
  | "no_api_key"
  | "old_pi"
  | "oversized"
  | "incomplete"
  | "capped"
  | "never"
  | "pending"
  | "shadow"
  | "error"
  | "stale";

const DEFER: AuthorizerVerdict = { kind: "defer" };

/** The permission system's surfaces where a link's `allow` is capped, as it decides them. */
const CAPPED = /^(?:path|external_directory)(?:_read|_write)?$/;

function capped(details: PromptPermissionDetails): boolean {
  const surface = details.accessIntent?.surface ?? details.surface ?? undefined;
  return surface === undefined || CAPPED.test(surface);
}

/**
 * The `auto-mode` chain link. Every path that is not a clean Jev verdict defers,
 * so the human (or, headless, the permission system's own denial) decides.
 */
export async function authorize(
  details: PromptPermissionDetails,
  ctx: LinkContext,
  log: AuthorizerLog,
): Promise<AuthorizerVerdict> {
  const record = (verdict: string, extra: Record<string, unknown>) => {
    try {
      log.review("auto_mode_verdict", {
        requestId: details.requestId,
        toolCallId: details.toolCallId,
        toolName: details.toolName,
        mode: ctx.mode(),
        verdict,
        ...extra,
      });
    } catch {
      // The audit trail must never turn a verdict into an error.
    }
  };
  const defer = (why: Why, extra: Record<string, unknown> = {}) => {
    record("defer", { why, ...extra });
    return DEFER;
  };

  try {
    if (ctx.mode() === "off") return DEFER;
    // The permission system never lets a link approve paths or outside-project access,
    // so asking Jev there would only send it the call.
    if (capped(details)) return defer("capped");

    const resolved = resolveState({
      branch: ctx.branch(),
      details,
      prepared: ctx.prepared,
      tools: ctx.tools(),
      cwd: ctx.cwd,
      environment: ctx.environment,
    });
    if (!resolved.ok) return defer(resolved.why);
    if (isOversized(resolved.state)) {
      ctx.setStatus("asking you: too long for Jev to read");
      return defer("oversized");
    }

    const never =
      details.toolName === "bash" ? neverAutoAllow(resolved.state.action.input) : undefined;
    if (never) {
      if (ctx.mode() === "shadow")
        return defer("shadow", { never, wouldBe: ctx.hasUI ? "defer" : "deny" });
      if (ctx.hasUI) {
        ctx.setStatus(`asking you: ${never}`);
        return defer("never", { never });
      }
      record("deny", { why: "never", never });
      return {
        kind: "deny",
        reason: `auto-mode blocked this call because it ${never}, which always needs a human, and no human is available to approve it. Do not retry it or work around it; tell the user what you wanted to run and why.`,
      };
    }

    // Jev cannot rule out a limit the user set in text it never sees.
    if (!resolved.intentTrusted) {
      ctx.setStatus("asking you: too long for Jev to read");
      return defer("incomplete");
    }
    if (ctx.pendingInput()) return defer("pending");

    const model = jevModel(ctx.models, ctx.config);
    if (!model) return defer("old_pi");
    const apiKey = await ctx.apiKey();
    if (!apiKey) return defer("no_api_key");

    let result;
    try {
      result = await askJev({
        models: ctx.models,
        model,
        apiKey,
        state: resolved.state,
        timeoutMs: ctx.config.timeoutMs,
        signal: ctx.signal(),
        fetch: ctx.fetch,
      });
    } catch (error: unknown) {
      const err = error instanceof JevError ? error : new JevError("network", String(error));
      ctx.jevResult?.(err);
      ctx.setStatus("asking you: Jev didn't answer");
      return defer("error", { error: err.kind, status: err.status, message: err.message });
    }
    ctx.jevResult?.(undefined);

    const routed = route(result.answers, ctx.config.thresholds, ctx.hasUI);
    const trail = {
      probabilities: result.answers,
      latencyMs: result.latencyMs,
      model: result.model,
      intentTrusted: resolved.intentTrusted,
      ...(routed.kind === "allow" ? {} : { hazard: routed.flag.hazard }),
    };

    // The call, or a call it runs under, may have ended while Jev was answering.
    const again = resolveAction(ctx.branch(), details, ctx.prepared);
    if (
      !ctx.isCurrent() ||
      typeof again === "string" ||
      again.input !== resolved.state.action.input
    ) {
      return defer("stale", trail);
    }
    if (routed.kind === "allow" && ctx.pendingInput()) return defer("pending", trail);
    const mode = ctx.mode();
    if (mode === "off") return DEFER;
    if (mode === "shadow") return defer("shadow", { ...trail, wouldBe: routed.kind });

    record(routed.kind, trail);
    if (routed.kind === "allow") return { kind: "allow" };
    if (routed.kind === "deny") return { kind: "deny", reason: routed.reason };
    ctx.setStatus(`asking you: ${flagText(routed.flag)}`);
    return DEFER;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    return defer("error", { error: "internal", message: err.message });
  }
}
