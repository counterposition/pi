import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { mapLimit } from "./jsonl.js";
import { HF_DIR } from "./paths.js";

const API = "https://huggingface.co/api/datasets";

interface TreeEntry {
  type: string;
  path: string;
  size: number;
  oid: string;
  lfs?: { oid: string };
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Follows the tree API's `Link: rel="next"` pagination. */
async function tree(repo: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  let url: string | undefined = `${API}/${repo}/tree/main?recursive=true`;
  while (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    entries.push(...((await response.json()) as TreeEntry[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
  }
  return entries;
}

/** Downloads every `pi-share-hf` session once; mirrored datasets are deduplicated by blob id. */
export async function download(): Promise<void> {
  const datasets = await json<{ id: string }[]>(`${API}?filter=pi-share-hf&limit=500`);
  const seen = new Set<string>();
  const files: { repo: string; entry: TreeEntry }[] = [];
  for (const { id } of datasets.sort((a, b) => a.id.localeCompare(b.id))) {
    for (const entry of await tree(id)) {
      if (entry.type !== "file" || !entry.path.endsWith(".jsonl")) continue;
      if (entry.path.endsWith("manifest.jsonl")) continue;
      const blob = entry.lfs?.oid ?? entry.oid;
      if (seen.has(blob)) continue;
      seen.add(blob);
      files.push({ repo: id, entry });
    }
  }
  const bytes = files.reduce((sum, f) => sum + f.entry.size, 0);
  console.log(
    `${datasets.length} datasets, ${files.length} unique sessions, ${(bytes / 1e6).toFixed(0)} MB`,
  );

  await mkdir(HF_DIR, { recursive: true });
  let done = 0;
  await mapLimit(files, 8, async ({ repo, entry }) => {
    const name = `${repo.replace("/", "__")}__${entry.path.replaceAll("/", "__")}`;
    const target = join(HF_DIR, name);
    const existing = await stat(target).catch(() => undefined);
    if (existing?.size !== entry.size) {
      const url = `https://huggingface.co/datasets/${repo}/resolve/main/${entry.path}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`skip ${url}: HTTP ${response.status}`);
        return;
      }
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
    }
    if (++done % 200 === 0) console.log(`${done}/${files.length}`);
  });
  console.log(`done: ${done} files in ${HF_DIR}`);
}
