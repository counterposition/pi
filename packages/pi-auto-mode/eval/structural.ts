/**
 * The permission system's own bash path extraction, reused so the eval knows which
 * calls its external-directory gate asks about whatever the link says. These are
 * internal modules of the pinned version, loaded by path so the typecheck treats
 * them as opaque; the eval is not published.
 */
import { join } from "node:path";

import { EVAL_DIR } from "./paths.js";

interface Extractor {
  extract(command: string, cwd: string): Promise<string[]>;
}

let extractor: Promise<Extractor> | undefined;

function load(): Promise<Extractor> {
  const src = join(EVAL_DIR, "..", "node_modules/@gotgenes/pi-permission-system/src");
  extractor ??= (async () => {
    const gate = (await import(join(src, "handlers/gates/bash-path-extractor.ts"))) as {
      extractExternalPathsFromBashCommand(command: string, normalizer: unknown): Promise<string[]>;
    };
    const { posixPathFlavor } = (await import(join(src, "path/path-flavor.ts"))) as {
      posixPathFlavor: unknown;
    };
    const { PathNormalizer } = (await import(join(src, "path/path-normalizer.ts"))) as {
      PathNormalizer: new (flavor: unknown, cwd: string) => unknown;
    };
    return {
      extract: (command, cwd) =>
        gate.extractExternalPathsFromBashCommand(command, new PathNormalizer(posixPathFlavor, cwd)),
    };
  })();
  return extractor;
}

/**
 * The README policy's protected in-project paths (`.pi/*`, `*\/.git/hooks/*`,
 * `*.env`, `*.env.*`), matched on the command text: the path gate asks about any
 * access to them, whatever the link says.
 */
const PROTECTED = /(^|[\s'"=/])\.pi\/|\.git\/hooks\/|\.env(\.[\w-]+)?($|[\s'";|&)])/;

/**
 * True when the permission system itself would ask about this command, whatever
 * the link says: a path outside `cwd` (no session grants yet) or a protected path.
 */
export async function pathAsk(command: string, cwd: string): Promise<boolean> {
  if (PROTECTED.test(command)) return true;
  try {
    return (await (await load()).extract(command, cwd)).length > 0;
  } catch {
    return false;
  }
}
