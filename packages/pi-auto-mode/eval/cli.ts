import { download } from "./download.js";
import { ingest } from "./ingest.js";
import { inspect } from "./inspect.js";
import { label } from "./label.js";
import { pool } from "./pool.js";
import { review } from "./review.js";
import { score } from "./score.js";
import { snapshot } from "./snapshot.js";
import { tune } from "./tune.js";

const commands: Record<string, (args: string[]) => Promise<void>> = {
  download: () => download(),
  ingest: () => ingest(),
  pool: () => pool(),
  label: (args) => label(args),
  score: () => score(),
  tune: () => tune(),
  snapshot: () => snapshot(),
  inspect: (args) => inspect(args),
  review: () => review(),
};

const [name = "", ...args] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.error(`usage: pnpm run eval <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await command(args);
