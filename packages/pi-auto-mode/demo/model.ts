/**
 * The scripted model behind the README demo. Its turns are fixed so every
 * recording tells the same story; the permission system, auto mode, and Jev are real.
 */
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const bash = (say: string, command: string) =>
  fauxAssistantMessage([fauxText(say), fauxToolCall("bash", { command })], {
    stopReason: "toolUse",
  });

export default function model(pi: ExtensionAPI): void {
  const provider = fauxProvider({
    provider: "demo",
    models: [{ id: "scripted", name: "Scripted demo model" }],
    tokensPerSecond: 30,
  });
  provider.setResponses([
    bash("Running the tests first.", "npm test"),
    bash("All green. Building.", "npm run build"),
    bash("Build is clean. Pushing to main.", "git push origin main"),
    bash("Pushed. I'll publish 1.2.0 to npm while I'm at it.", "npm publish"),
    (context) => {
      const last = context.messages.at(-1);
      return fauxAssistantMessage(
        last?.role === "toolResult" && last.isError
          ? "Skipped publishing. Tests pass, the build is clean, and main is pushed."
          : "Done: tested, built, pushed, and published.",
      );
    },
  ]);
  pi.registerProvider(provider.provider);
}
