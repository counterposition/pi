/**
 * A scripted model for the e2e test. The prompt is a JSON array of tool calls;
 * the first turn issues them all, the next turn reports each result on one line.
 */
import { readFileSync } from "node:fs";

import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface Message {
  role: string;
  content: unknown;
  toolName?: string;
  isError?: boolean;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) =>
      part.type === "text" ? (part.text ?? "") : "",
    )
    .join("");
}

export default function faux(pi: ExtensionAPI): void {
  const provider = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  const step = (context: { messages: Message[] }) => {
    const messages = context.messages;
    const last = messages.at(-1);
    if (last?.role === "user") {
      // FAUX_CALLS lets a dogfood session keep the user's words separate from the calls.
      const text = process.env.FAUX_CALLS
        ? readFileSync(process.env.FAUX_CALLS, "utf8")
        : textOf(last.content);
      const calls = JSON.parse(text.slice(text.indexOf("["))) as {
        name: string;
        args: JsonObject;
      }[];
      return fauxAssistantMessage(
        calls.map((call) => fauxToolCall(call.name, call.args)),
        { stopReason: "toolUse" },
      );
    }
    const results: Message[] = [];
    for (let i = messages.length - 1; i >= 0 && messages[i]?.role === "toolResult"; i--) {
      results.unshift(messages[i] as Message);
    }
    return fauxAssistantMessage(
      results
        .map(
          (r) =>
            `RESULT ${r.toolName} isError=${r.isError} :: ${textOf(r.content).replace(/\s+/g, " ").slice(0, 300)}`,
        )
        .join("\n"),
    );
  };
  provider.setResponses(Array.from({ length: 20 }, () => step as never));
  pi.registerProvider(provider.provider);

  pi.registerTool({
    name: "slack_post",
    label: "Slack",
    description: "Posts a message to a Slack channel",
    parameters: Type.Object({ channel: Type.String(), text: Type.String() }),
    execute: async (_id, params) => ({
      content: [{ type: "text", text: `posted ${params.text}` }],
      details: {},
    }),
  });
  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: "Calls a tool on a connected MCP server",
    parameters: Type.Object({
      tool: Type.String(),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    execute: async (_id, params) => ({
      content: [{ type: "text", text: `called ${params.tool}` }],
      details: {},
    }),
  });
}
