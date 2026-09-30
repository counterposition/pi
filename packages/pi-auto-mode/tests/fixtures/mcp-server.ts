/**
 * A stdio MCP server for the e2e test, run by Pi's MCP extension. It offers one
 * tool, `create_issue`, which only echoes its title.
 */
import { createInterface } from "node:readline";

interface Request {
  id?: number | string;
  method: string;
  params?: { protocolVersion?: string; arguments?: { title?: string } };
}

const reply = (id: Request["id"], result: unknown) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line) as Request;
  if (request.id === undefined) return;
  switch (request.method) {
    case "initialize":
      reply(request.id, {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "tracker", version: "1.0.0" },
      });
      return;
    case "tools/list":
      reply(request.id, {
        tools: [
          {
            name: "create_issue",
            description: "Creates an issue in the tracker",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
        ],
      });
      return;
    case "ping":
      reply(request.id, {});
      return;
    case "tools/call":
      reply(request.id, {
        content: [{ type: "text", text: `created ${request.params?.arguments?.title}` }],
      });
      return;
    default:
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "unknown method" } })}\n`,
      );
  }
});
