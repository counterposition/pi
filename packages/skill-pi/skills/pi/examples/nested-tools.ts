// A tool that runs other tools with ctx.executeTool() and keeps abort distinct from failure.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_many",
    label: "Read many",
    description: "Read several files in parallel through the read tool.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    }),
    // Declared to the model but never callable from other tools, so codemode cannot recurse into it.
    exposure: "model-only",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // ctx.tools lists what ctx.executeTool() can reach: active direct tools plus every
      // codemode/deferred tool. An inactive direct tool is not callable.
      if (!ctx.tools.some((tool) => tool.name === "read")) {
        throw new Error("read_many needs the read tool to be active");
      }

      let finished = 0;
      const outcomes = await Promise.all(
        params.paths.map(async (path) => {
          // Each call runs tool_call/tool_result handlers (permission gates included) with
          // parentToolCallId set to this call's id. It never rejects; failures come back as isError.
          const outcome = await ctx.executeTool("read", { path }, { signal });
          finished += 1;
          onUpdate?.({
            content: [{ type: "text", text: `Read ${finished}/${params.paths.length}` }],
            details: undefined,
          });
          return { path, outcome };
        }),
      );

      // Aborted nested calls also come back as isError. Rethrow the abort instead of reporting
      // every file as failed.
      signal?.throwIfAborted();

      const failed = outcomes.filter(({ outcome }) => outcome.isError).map(({ path }) => path);
      return {
        content: outcomes.flatMap(({ path, outcome }) => [
          { type: "text" as const, text: `--- ${path}${outcome.isError ? " (failed)" : ""}` },
          ...outcome.result.content,
        ]),
        details: { failed },
        isError: failed.length === params.paths.length,
      };
    },
  });
}
