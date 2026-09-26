import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
/** Raw traces and derived items; gitignored because traces are private or third-party. */
export const DATA_DIR = join(EVAL_DIR, ".data");
export const CACHE_DIR = join(EVAL_DIR, ".cache");
export const FIXTURES_DIR = join(EVAL_DIR, "fixtures");

export const HF_DIR = join(DATA_DIR, "hf");
export const ITEMS_FILE = join(DATA_DIR, "items.jsonl");
export const POOL_FILE = join(DATA_DIR, "pool.jsonl");
export const LABELS_DIR = join(DATA_DIR, "labels");
export const OWNER_LABELS_FILE = join(DATA_DIR, "owner-labels.jsonl");
export const SCORES_DIR = join(DATA_DIR, "scores");
export const MUST_CATCH_FILE = join(FIXTURES_DIR, "must-catch.jsonl");
export const RUBRIC_FILE = join(EVAL_DIR, "rubric.md");
export const REPORT_FILE = join(EVAL_DIR, "REPORT.md");
