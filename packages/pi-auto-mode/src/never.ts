/**
 * Shell commands that go to a human whatever Jev says: they weaken security or add
 * persistence, where a classifier's mistake is too costly. A backstop for Jev, not a
 * parser: any mention of such a command in the text asks, wherever it appears (in a
 * wrapper, a nested shell, a heredoc, a pipe into a shell, or plain data), after quotes,
 * backslashes, and line continuations are removed so they cannot split a word. Text
 * built while the command runs (variables, command output, decoded or escaped bytes)
 * is left to Jev, whose `opaque` question covers it. Only the `bash` tool's `command`
 * (or `cmd`) is read.
 */

/**
 * `at` and `batch` are common words, so they are recognized by what follows rather than
 * by where they stand: with a time or date (`now`, `17:00`, `5pm`, `2025-12-25`,
 * `Dec 25`, `Monday`, `+ 1 hour`, `next day`) or an option (for `at`, any but `-l`,
 * which only lists); `at` directly before a redirection (`at <job.sh now`, `at>log`);
 * `batch` alone or before a redirection or pipe.
 * Either may be glued to a shell's `-c` or env's `-S` (`-c'batch'`, `env -S'at now'`),
 * and as a shell's `-c` script anything may follow (`bash -c batch x`). Names match in
 * any case, since a case-insensitive filesystem runs `AT` too. One linear pattern.
 */
const WHEN = String.raw`now|noon|midnight|teatime|tomorrow|today|\+\s*\d|next\s+(?:min|hour|day|week|month|year)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d|(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|mon|tue|wed|thu|fri|sat|sun)\b(?!’)`;
const SCHEDULE = new RegExp(
  String.raw`-[a-zA-Z]*[cS]\s*(?:at|batch)\b|(?:^|[\s;&|(\x60{!/=]|-[a-zA-Z]*[cS])(?:at\s*\d*&?[<>]|at\s+(?:${WHEN}|\d[\d:./-]*(?:am|pm)?(?:utc)?(?=\s|$|[;&|)<>])|-(?!l\b|-list\b)\S)|batch(?=\s*$|\s*\d*[;&|<>)#]|\s+(?:-|\d|${WHEN})))`,
  "im",
);

/** `a`, then `b` somewhere after it: two linear passes, however often `a` recurs. */
const after =
  (a: RegExp, b: RegExp) =>
  (text: string): boolean => {
    const i = text.search(a);
    return i !== -1 && b.test(text.slice(i));
  };
const matches = (pattern: RegExp) => (text: string) => pattern.test(text);

// Patterns span separators on purpose: quotes are gone, so a `;` or `|` may have been
// inside an argument (`curl -H 'X: ;' -k`). Matching across commands only over-asks.
const RULES: [(text: string) => boolean, string][] = [
  // Distinctive names match even glued to other text (`-csystemctl`, `crontab040`).
  // Names in any case: a case-insensitive filesystem runs `CRONTAB` and `CURL` too.
  [matches(/crontab|atrm/i), "changes scheduled jobs"],
  [matches(SCHEDULE), "changes scheduled jobs"],
  [after(/launchctl/i, /\b(?:load|bootstrap|enable|submit)\b/i), "adds a background service"],
  [after(/systemctl/i, /\b(?:re)?enable\b/i), "adds a background service"],
  // Any `start` after `brew services`, since option values may hold spaces.
  [after(/brew\s+services\b/i, /\b(?:re)?start\b/i), "adds a background service"],
  [after(/systemd-run/i, /--(?:on-[a-z-]+|timer-property)\b/i), "changes scheduled jobs"],
  [after(/security/i, /add-trusted-cert/i), "weakens platform security"],
  [after(/spctl/i, /--master-disable/i), "weakens platform security"],
  [after(/csrutil/i, /\bdisable\b/i), "weakens platform security"],
  [
    matches(
      /--(?:[a-z]+-)?insecure\b|--no-check-certificate\b|\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|\bGIT_SSL_NO_VERIFY\b|sslverify|strict[-_]ssl|--no-verify-ssl\b|tls[-_]?verify\s*=\s*(?:false|0)\b|--trusted-host\b|\bPYTHONHTTPSVERIFY\s*=\s*0|--verify[=\s]\s*(?:no|false)\b/i,
    ),
    "turns off certificate checks",
  ],
  [
    matches(
      /stricthostkeychecking\s*[=\s]\s*(?:no|off|false)\b|userknownhostsfile\s*[=\s]\s*\/dev\/null/i,
    ),
    "turns off SSH host key checks",
  ],
  // curl's short options include punctuation (`-#k`); `-K` is a different option.
  [after(/curl/i, /\s-(?!-)\S*k/), "turns off certificate checks"],
];

/** Why a shell call must reach a human, or undefined when Jev may judge it. */
export function neverAutoAllow(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const text = typeof record.command === "string" ? record.command : record.cmd;
  if (typeof text !== "string") return undefined;
  // Joined words: `cr''ontab`, `c\rontab`, and a continued `cron\` line read as crontab.
  // `$'...'` and `$"..."` quoting is literal concatenation too: `cr$''ontab`.
  const unquoted = text
    .replace(/\\\n/g, "")
    .replace(/\$(?=['"])/g, "")
    .replace(/['"]/g, "");
  const joined = unquoted.replace(/\\/g, "");
  // A printed escape may also end a word: `printf 'batch\n' | sh`.
  const spaced = unquoted.replace(
    /\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
    " ",
  );
  return RULES.find(([test]) => test(joined) || test(spaced))?.[1];
}
