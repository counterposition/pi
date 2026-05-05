import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionHandler,
} from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

describe("Pi API type coverage", () => {
  it("uses return-based before_agent_start prompt results", () => {
    const handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult> = (
      event,
    ) => {
      return {
        systemPrompt: `${event.systemPrompt}\n\nmemory prompt`,
      } satisfies BeforeAgentStartEventResult;
    };

    const result = handler(
      {
        type: "before_agent_start",
        prompt: "remember",
        systemPrompt: "base",
        systemPromptOptions: {},
      } as BeforeAgentStartEvent,
      {} as Parameters<ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>>[1],
    );

    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("memory prompt"),
    });
  });
});
