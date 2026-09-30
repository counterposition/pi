// A tool that returns data: codemode scripts receive `structuredContent`, the model reads `content`.
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

const FileStatsResult = Type.Object({
  files: Type.Array(
    Type.Object({
      path: Type.String(),
      bytes: Type.Number(),
      modified: Type.String({ description: "ISO 8601 timestamp" }),
    }),
  ),
  missing: Type.Array(Type.String()),
});

type FileStatsResult = Static<typeof FileStatsResult>;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "file_stats",
    label: "File stats",
    description: "Return the size and modification time of files in the working directory.",
    parameters: Type.Object({
      paths: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }),
    }),
    outputSchema: FileStatsResult,
    annotations: { readOnlyHint: true, openWorldHint: false },
    namespace: { name: "fs_info", description: "Read-only file metadata" },
    // Default exposure is "direct". "codemode" would keep it out of the model's tool list
    // while scripts can still call it.
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result: FileStatsResult = { files: [], missing: [] };
      for (const path of params.paths) {
        signal?.throwIfAborted();
        try {
          const stats = await stat(resolve(ctx.cwd, path));
          result.files.push({ path, bytes: stats.size, modified: stats.mtime.toISOString() });
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            result.missing.push(path);
          } else {
            throw error;
          }
        }
      }

      const lines = result.files.map((file) => `${file.path}: ${file.bytes} bytes`);
      if (result.missing.length > 0) lines.push(`Missing: ${result.missing.join(", ")}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: undefined,
        structuredContent: result,
        // A failure that still carries data: the model sees an error, scripts still get the object.
        isError: result.files.length === 0,
      };
    },
  });
}
