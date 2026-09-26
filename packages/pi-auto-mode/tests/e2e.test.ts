/**
 * Headless end to end: the repo's Pi binary, a scripted faux model,
 * pi-permission-system with the base policy, the auto-mode link, and a local
 * fake Jev server. No network.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QUESTION_IDS } from "../src/questions.js";
import type { JevState } from "../src/state.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, "..");
const modules = join(packageDir, "node_modules");
const PI_CLI = join(modules, "@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const PERMISSIONS = join(modules, "@gotgenes/pi-permission-system");

const POLICY = {
  authorizerChain: ["auto-mode"],
  permission: {
    "*": "ask",
    read: "allow",
    grep: "allow",
    find: "allow",
    ls: "allow",
    write: "allow",
    edit: "allow",
    path: { "*": "allow", ".pi/*": "ask", "*/.pi/*": "ask" },
    external_directory: "ask",
    bash: { "*": "ask", "git status": "allow" },
  },
};

interface JevRequest {
  auth: string | undefined;
  state: JevState;
}

let server: Server;
let root: string;
const requests: JevRequest[] = [];

/** Flags anything mentioning FLAG, fails anything mentioning BROKEN, and is happy otherwise. */
function startJev(): Promise<string> {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { state: JevState };
      requests.push({ auth: req.headers.authorization, state: parsed.state });
      const action = JSON.stringify(parsed.state.action);
      if (action.includes("BROKEN")) {
        res.writeHead(500).end("boom");
        return;
      }
      const flagged = action.includes("FLAG");
      const answers = Object.fromEntries(
        QUESTION_IDS.map((id) => [
          id,
          { type: "noul", noul: id === "external" && flagged ? 0.97 : 0.02 },
        ]),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "jev-1.13.0", answers }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(
        `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1/systemone`,
      );
    }),
  );
}

/** `pi -p` reads piped stdin until EOF, so stdin is closed. */
function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`pi exited ${code}: ${stderr}`)),
    );
  });
}

async function runPi(
  calls: { name: string; args: Record<string, unknown> }[],
  order: "auto-mode first" | "permissions first" = "auto-mode first",
): Promise<string[]> {
  // auto-mode must load first so it sees each prepared call before the permission gate.
  const extensions =
    order === "auto-mode first" ? [packageDir, PERMISSIONS] : [PERMISSIONS, packageDir];
  const { stdout } = await run(
    process.execPath,
    [
      PI_CLI,
      "-p",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "-e",
      join(here, "fixtures/faux.ts"),
      ...extensions.flatMap((path) => ["-e", path]),
      "--model",
      "faux/faux-1",
      `Run these: ${JSON.stringify(calls)}`,
    ],
    {
      cwd: join(root, "project"),
      env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent") },
    },
  );
  return stdout.split("\n").filter((line) => line.startsWith("RESULT"));
}

beforeAll(async () => {
  const url = await startJev();
  root = await mkdtemp(join(tmpdir(), "auto-mode-e2e-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "extensions/pi-permission-system"), { recursive: true });
  await mkdir(join(root, "project"), { recursive: true });
  const git = { cwd: join(root, "project"), env: process.env };
  await run("git", ["init", "-q"], git);
  await run("git", ["remote", "add", "origin", "https://token@github.com/acme/app.git"], git);
  await writeFile(
    join(agent, "extensions/pi-permission-system/config.json"),
    JSON.stringify(POLICY),
  );
  await writeFile(
    join(agent, "auto-mode.json"),
    JSON.stringify({ apiKey: "e2e-key", url, timeoutMs: 2000 }),
  );
});

afterAll(async () => {
  server?.close();
  if (root && !process.env.KEEP_E2E) await rm(root, { recursive: true, force: true });
  else console.log(root);
});

describe.skipIf(!existsSync(PI_CLI))("headless e2e", () => {
  it("allows safe calls, denies flagged ones with a reason, and defers failures", async () => {
    const results = await runPi([
      { name: "bash", args: { command: "echo safe-call" } },
      { name: "bash", args: { command: "echo FLAG-call" } },
      { name: "bash", args: { command: "git status" } },
      { name: "bash", args: { command: "echo BROKEN-call" } },
      { name: "slack_post", args: { channel: "#general", text: "hello" } },
      { name: "slack_post", args: { channel: "#general", text: "FLAG" } },
      { name: "mcp", args: { tool: "github:create_issue", args: { title: "t" } } },
      { name: "write", args: { path: ".pi/extensions/evil.ts", content: "x" } },
    ]);
    const line = (needle: string) => results.find((r) => r.includes(needle)) ?? "";

    expect(results).toHaveLength(8);
    expect(results[0]).toMatch(/RESULT bash isError=false :: safe-call/);
    expect(results[1]).toMatch(/isError=true/);
    expect(results[1]).toContain("auto-mode blocked this call");
    expect(results[1]).toContain("external 0.97");
    expect(results[2]).toMatch(/RESULT bash isError=false/);
    expect(results[3]).toMatch(/isError=true/);
    expect(results[3]).not.toContain("auto-mode blocked");
    expect(line("posted hello")).toMatch(/RESULT slack_post isError=false/);
    expect(results[5]).toMatch(/RESULT slack_post isError=true .*auto-mode blocked/);
    expect(line("called github:create_issue")).toMatch(/RESULT mcp isError=false/);
    expect(results[7]).toMatch(/RESULT write isError=true/);
    expect(existsSync(join(root, "project/.pi/extensions/evil.ts"))).toBe(false);

    const commands = requests.map((r) => JSON.stringify(r.state.action));
    expect(requests.every((r) => r.auth === "Bearer e2e-key")).toBe(true);
    expect(commands.some((c) => c.includes("git status"))).toBe(false);
    expect(
      requests.find((r) => r.state.action.tool === "slack_post")?.state.action.description,
    ).toBe("Posts a message to a Slack channel");
    expect(requests[0]?.state.user_messages[0]).toContain("Run these");
    expect(requests[0]?.state.environment.join()).toContain("github.com/acme/app");
    expect(requests[0]?.state.environment.join()).not.toContain("token");
  }, 90_000);

  it("sends every ask to a human when it loads after the permission system", async () => {
    const results = await runPi(
      [
        { name: "bash", args: { command: "echo safe-again" } },
        { name: "slack_post", args: { channel: "#general", text: "hello" } },
      ],
      "permissions first",
    );
    expect(results[0]).toMatch(/RESULT bash isError=true .*requires approval/);
    expect(results[1]).toMatch(/RESULT slack_post isError=true .*requires approval/);
  }, 90_000);
});
