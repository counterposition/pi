import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  AuthorizerLog,
  AuthorizerVerdict,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";

import type { AutoModeConfig, Mode } from "./config.js";
import { askClassifier, ClassifierError } from "./classifier.js";
import type { Classifier } from "./classifier.js";
import { flagText, route, TUNED_REVISIONS } from "./route.js";
import { neverAutoAllow } from "./never.js";
import { isOversized, resolveAction, resolveState } from "./state.js";
import type { BranchEntry, PreparedLookup, ToolDescription, Unresolved } from "./state.js";

export const LINK_NAME = "auto-mode";

export interface LinkContext {
  /** Read live: `/auto` can change it while a classifier request is in flight. */
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
  /** Pi's model registry, which runs the request with the provider's credentials. */
  models: ModelRegistry;
  /**
   * The configured classifier, or undefined while it is missing or has no credentials.
   * `signal` bounds any credential check it makes.
   */
  classifier(signal: AbortSignal): Promise<Classifier | undefined>;
  /** The agent run's abort signal, if it is running. */
  signal(): AbortSignal | undefined;
  /** Shows a flagged call's hazard next to the approval dialog. */
  setStatus(label: string | undefined): void;
  /** Told whether each classifier request worked, so a failing setup can surface. */
  classifierResult?(error: ClassifierError | undefined): void;
}

type Why =
  | Unresolved
  | "no_classifier"
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
 * The `auto-mode` chain link. Every path that is not a clean classifier verdict defers,
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
    // so asking the classifier there would only send it the call.
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
      ctx.setStatus("asking you: too long for the classifier to read");
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

    // The classifier cannot rule out a limit the user set in text it never sees.
    if (!resolved.intentTrusted) {
      ctx.setStatus("asking you: too long for the classifier to read");
      return defer("incomplete");
    }
    if (ctx.pendingInput()) return defer("pending");

    // One deadline covers finding the classifier and asking it.
    const deadline = AbortSignal.timeout(ctx.config.timeoutMs);
    const run = ctx.signal();
    const model = await ctx.classifier(run ? AbortSignal.any([run, deadline]) : deadline);
    if (!model) return defer("no_classifier");

    let result;
    try {
      result = await askClassifier({
        models: ctx.models,
        model,
        state: resolved.state,
        deadline,
        signal: run,
        revision: TUNED_REVISIONS[ctx.config.model],
      });
    } catch (error: unknown) {
      const err =
        error instanceof ClassifierError ? error : new ClassifierError("failed", String(error));
      ctx.classifierResult?.(err);
      ctx.setStatus("asking you: the classifier didn't answer");
      return defer("error", { error: err.kind, status: err.status, message: err.message });
    }
    ctx.classifierResult?.(undefined);

    const routed = route(result.answers, ctx.config.thresholds, ctx.hasUI);
    const trail = {
      probabilities: result.answers,
      latencyMs: result.latencyMs,
      model: ctx.config.model,
      intentTrusted: resolved.intentTrusted,
      ...(routed.kind === "allow" ? {} : { hazard: routed.flag.hazard }),
    };

    // The call, or a call it runs under, may have ended while the classifier was answering.
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
