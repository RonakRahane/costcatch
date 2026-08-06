/**
 * Secret + PII redaction and terminal-escape scrubbing.
 *
 * Captured conversation content is stored locally and shown by `show`/`--inspect`.
 * Before anything is persisted or printed we scrub credentials, PII, and
 * terminal control sequences, so a saved trace is safe to share (paste into a
 * PR, an issue, a teammate DM) and safe to `cat`.
 *
 * Three tiers, all on by default:
 *   1. Control characters — ANSI/OSC escapes and other non-printables.
 *   2. Secrets — provider API keys, bearer tokens, `secret: value` pairs. High
 *      confidence; always redacted.
 *   3. PII — emails, formatted phone numbers, Luhn-valid card numbers. Tuned to
 *      minimize false positives (phones require separators; cards must pass a
 *      Luhn check) so we don't shred legitimate prompt content.
 *
 * Note: request headers (where API keys normally live) are NEVER captured by the
 * interceptors in the first place — this pass only guards secrets a user pasted
 * INTO a prompt or that a tool result echoed back. Everything stays local.
 */

const REDACTED = "«redacted»";

// ---------------------------------------------------------------------------
// Tier 1 — terminal control sequences
// ---------------------------------------------------------------------------

/**
 * Escape sequences stripped from captured text.
 *
 * Everything we capture is attacker-influenced: a model can be prompt-injected
 * into emitting raw ANSI, and tool results routinely echo remote content back
 * into the conversation. `show` and `--inspect` print that text straight to a
 * terminal, so an un-scrubbed `ESC[2J` clears the user's screen, `ESC]0;…BEL`
 * rewrites the window title, and cursor-movement codes can overwrite lines
 * already printed — forging output the tool never produced (CWE-150).
 *
 * Built from a string so the source stays readable: embedding literal control
 * bytes in a regex literal makes this block impossible to review or diff.
 */
const ANSI_SEQUENCE = new RegExp(
  [
    // Order matters: the specific multi-byte forms must be tried before the
    // two-character catch-all, or `ESC [` would be eaten without its parameters.
    "\\u001b\\[[0-?]*[ -/]*[@-~]", // CSI — colours, cursor movement, screen clear
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?", // OSC — window title, hyperlinks
    "\\u001b[ -/]+[0-~]", // nF — charset designation, e.g. ESC ( B
    "\\u001b[0-~]", // Fp/Fe/Fs two-character escapes: RIS, DECSC (ESC 7), DECRC
    "\\u009b[0-?]*[ -/]*[@-~]", // 8-bit CSI
  ].join("|"),
  "g",
);

/** Non-printables that survive escape stripping. Tab and newline are kept. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]", "g");

/**
 * Remove terminal escape sequences and non-printable control characters.
 *
 * Applied at capture time so a saved trace is inert: safe to `cat`, safe to
 * paste into an issue, safe to render in any consumer of the JSON. Carriage
 * returns are normalized rather than dropped, so Windows-authored content keeps
 * its line breaks while a bare `\r` cannot rewind the cursor over earlier output.
 */
export function stripControl(input: string): string {
  if (!input) return input;
  return input
    .replace(ANSI_SEQUENCE, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "");
}

// ---------------------------------------------------------------------------
// Tier 2 — secrets
// ---------------------------------------------------------------------------

/**
 * Patterns that match a whole secret token to replace outright.
 *
 * Every quantifier is upper-bounded. These patterns are all anchored on a
 * literal prefix, so they are linear either way — but an unbounded `{20,}` is
 * one refactor away from becoming the next quadratic scan, and no real
 * credential is longer than a few hundred characters.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,512}/g, // Anthropic
  /sk-[A-Za-z0-9_-]{20,512}/g, // OpenAI / OpenAI-compatible
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /ASIA[0-9A-Z]{16}/g, // AWS temporary access key id
  /gsk_[A-Za-z0-9]{20,512}/g, // Groq
  /r8_[A-Za-z0-9]{20,512}/g, // Replicate
  /gh[pousr]_[A-Za-z0-9]{20,512}/g, // GitHub PAT / OAuth / user / server / refresh
  /xox[baprs]-[A-Za-z0-9-]{10,512}/g, // Slack
  /hf_[A-Za-z0-9]{20,512}/g, // Hugging Face
  /\bsk-or-v1-[A-Za-z0-9]{20,512}/g, // OpenRouter
  /\beyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/g, // JWT
];

/** `Authorization: Bearer <token>` style values. */
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{16,4096}/gi;

/**
 * `"api_key": "value"` / `secret=value` style pairs — redact the VALUE only,
 * keeping the key name so the reader still sees the shape.
 */
const LABELED_SECRET =
  /("?(?:api[_-]?key|secret|token|password|passwd|authorization|x-api-key|access[_-]?key|private[_-]?key)"?\s*[:=]\s*"?)([^"\s,}{]{8,4096})/gi;

// ---------------------------------------------------------------------------
// Tier 3 — PII
// ---------------------------------------------------------------------------

/**
 * Email addresses.
 *
 * The bounds are load-bearing, not cosmetic. Written as
 * `[A-Za-z0-9._%+-]+@…`, the local part happily consumes an entire prompt
 * before discovering there is no `@`, then backtracks one character at a time —
 * and repeats that from every subsequent position. That is O(n²) on ordinary
 * prose, and prose is what this regex runs on:
 *
 *   chars    unbounded    bounded
 *    1,000       23 ms      10 ms
 *    4,000      380 ms      44 ms
 *   16,000    6,282 ms     137 ms
 *
 * Since prompt length is entirely user-controlled, that is a CPU-exhaustion
 * vector (CWE-1333) reachable by pasting a long document into a prompt. The
 * bounds match RFC 5321 anyway — 64 octets of local part, 255 of domain — so
 * nothing that was matched before stops matching.
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

/**
 * Phone numbers — REQUIRES separators (or a leading +) between groups so we
 * don't nuke every 10-digit id or token count. Matches +1 415-555-1234,
 * (415) 555-1234, 415.555.1234, etc.
 */
const PHONE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;

/** Candidate card numbers: 13–19 digits, optionally grouped by space/dash. */
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

/** Luhn checksum — real card numbers pass; random digit runs almost never do. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    let d = n;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Redact only secrets (tier 2). Does not strip control characters. */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of TOKEN_PATTERNS) {
    p.lastIndex = 0; // reset — /g regexes carry state between calls
    out = out.replace(p, REDACTED);
  }
  out = out.replace(BEARER, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(LABELED_SECRET, (_m, prefix) => `${prefix}${REDACTED}`);
  return out;
}

/**
 * Full capture-time scrub: control characters, then secrets, then (optionally)
 * PII. This is what every persisted or printed content field passes through.
 *
 * @param input the text to scrub
 * @param pii   also redact emails / phones / cards (default true)
 */
export function redactString(input: string, pii: boolean = true): string {
  if (!input) return input;
  let out = redactSecrets(stripControl(input));
  if (pii) {
    out = out.replace(EMAIL, "«email»");
    out = out.replace(PHONE, "«phone»");
    out = out.replace(CARD_CANDIDATE, (m) => {
      const digits = m.replace(/[ -]/g, "");
      return passesLuhn(digits) ? "«card»" : m;
    });
  }
  return out;
}

/**
 * Whether a string still contains something that looks like a secret.
 * Uses fresh non-global regexes to avoid the flaky lastIndex mutation
 * that /g + .test() is infamous for.
 */
export function looksSecret(input: string): boolean {
  if (!input) return false;
  return TOKEN_PATTERNS.some((p) => {
    const nonGlobal = new RegExp(p.source, p.flags.replace("g", ""));
    return nonGlobal.test(input);
  });
}
