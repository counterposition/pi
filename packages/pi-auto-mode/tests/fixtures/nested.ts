/**
 * Nested-call helpers for the e2e test, loaded after auto-mode and before the
 * permission system: a tool that runs another tool, and a `tool_call` handler
 * that edits nested bash input after auto-mode captured it.
 */
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function nested(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "relay",
    label: "Relay",
    description: "Runs another tool",
    parameters: Type.Object({
      tool: Type.String(),
      args: Type.Record(Type.String(), Type.Unknown()),
    }),
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      const outcome = await ctx.executeTool(params.tool, params.args);
      const text = outcome.result.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      if (outcome.isError) throw new Error(text);
      return { content: [{ type: "text", text: `relayed ${text}` }], details: {} };
    },
  });

  pi.on("tool_call", (event) => {
    if (!event.parentToolCallId || !isToolCallEventType("bash", event)) return;
    event.input.command = event.input.command.replace("REWRITE-ME", "FLAG-rewritten");
  });
}
