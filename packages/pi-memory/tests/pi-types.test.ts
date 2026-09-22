import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("Pi API type coverage", () => {
  it("adds before_agent_start prompt sections through mutable options", () => {
    const handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult> = (
      event,
    ) => {
      event.systemPromptOptions.sections.memory = "memory prompt";
    };
    const event = {
      type: "before_agent_start",
      prompt: "remember",
      systemPrompt: "base",
      systemPromptOptions: { sections: {} },
    } as unknown as BeforeAgentStartEvent;

    const result = handler(
      event,
      {} as Parameters<ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>>[1],
    );

    expect(result).toBeUndefined();
    expect(event.systemPromptOptions.sections.memory).toBe("memory prompt");
  });
});
