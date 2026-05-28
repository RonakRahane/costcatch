// Removes terminal escapes, secrets and (unless turned off) personal data from captured text.

const REDACTED = "«redacted»";

// Model output can contain escape codes that clear the screen or fake lines when printed.
const ANSI_SEQUENCE = new RegExp(
  [
    // Keep the longer forms before the two-character catch-all, or ESC [ would match without its parameters.
    "\\u001b\\[[0-?]*[ -/]*[@-~]",
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)?",
    "\\u001b[ -/]+[0-~]",
    "\\u001b[0-~]",
    "\\u009b[0-?]*[ -/]*[@-~]",
  ].join("|"),
  "g",
);

// Tab and newline are left in.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]", "g");

/** Turns \r into \n rather than dropping it, so CRLF keeps its line breaks and no \r can move the cursor back. */
export function stripControl(input: string): string {
  if (!input) return input;
  return input
    .replace(ANSI_SEQUENCE, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "");
}

// Every quantifier has an upper bound so long input can't make these regexes slow (ReDoS).
const TOKEN_PATTERNS: RegExp[] = [
  // PEM keys go first, or later patterns would redact bits of the key body and leave the rest readable.
  /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g,

  // Skip sk- inside a word like "risk-assessment", but still match it right after an escape like \n or %22.
  /(?<!(?<![\\%]|%[0-9A-Fa-f])[A-Za-z0-9-])sk-ant-[A-Za-z0-9_-]{20,512}/g, // Anthropic
  /(?<!(?<![\\%]|%[0-9A-Fa-f])[A-Za-z0-9-])sk-[A-Za-z0-9_-]{20,512}/g, // OpenAI and compatible APIs
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,512}/g, // Stripe
  /whsec_[A-Za-z0-9+/]{20,512}={0,2}/g, // Stripe and Svix webhook secrets
  /SG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{30,64}/g, // SendGrid
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /\bya29\.[A-Za-z0-9_-]{20,512}/g, // Google OAuth access token
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /ASIA[0-9A-Z]{16}/g, // AWS temporary access key id
  /gsk_[A-Za-z0-9]{20,512}/g, // Groq
  /r8_[A-Za-z0-9]{20,512}/g, // Replicate
  /\bgithub_pat_[A-Za-z0-9_]{20,512}/g,
  /gh[pousr]_[A-Za-z0-9]{20,512}/g, // GitHub tokens
  /\bxapp-[0-9]-[A-Za-z0-9-]{10,512}/g, // Slack app-level token
  /xox[baprs]-[A-Za-z0-9-]{10,512}/g, // Slack
  /\bnpm_[A-Za-z0-9]{20,512}/g,
  /\bpypi-[A-Za-z0-9_-]{20,512}/g,
  /\bdop_v1_[a-f0-9]{32,128}/g, // DigitalOcean
  /hf_[A-Za-z0-9]{20,512}/g, // Hugging Face
  /\bsk-or-v1-[A-Za-z0-9]{20,512}/g, // OpenRouter
  /\beyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/g, // JWT
];

// The value must also look like a credential, or prose like "basic principles" would be redacted.
const AUTH_SCHEME =
  /((?:bearer|basic|digest|token|apikey|negotiate|aws4-hmac-sha256)\s+)([A-Za-z0-9._~+/=-]{8,4096})/gi;

function credentialShaped(s: string): boolean {
  return /\d/.test(s) || /[A-Z]/.test(s.slice(1));
}

// A quote with or without backslashes, since tool results often hold JSON inside a JSON string.
const QUOTE = String.raw`\\{0,7}"`;

const SECRET_WORDS = String.raw`api[_-]?key|secrets?|token|password|passwd|authorization|credentials?|access[_-]?key|account[_-]?key|private[_-]?key`;

// Redacts the value in "api_key": "value" or secret=value. A backslash counts as part of the
// value unless it escapes the closing quote, so escaped JSON stays valid.
const LABELED_SECRET = new RegExp(
  String.raw`((?:${QUOTE})?[A-Za-z0-9_.-]{0,40}(?:${SECRET_WORDS})[A-Za-z0-9_.-]{0,40}(?:${QUOTE})?\s*[:=]\s*(?:${QUOTE})?(?:(Bearer|Basic|Token|ApiKey|Digest)\s+)?)((?:[^"\s,}{\\]|\\(?!${QUOTE})){8,4096})`,
  "gi",
);

const LABEL_KEYWORD = new RegExp(SECRET_WORDS, "g");

// A keyword followed by a lowercase letter is part of another word, like "tokenizer" or
// "max_tokens". An uppercase letter ends it, as in secretKey.
function namesSecret(label: string): boolean {
  const lower = label.toLowerCase();
  LABEL_KEYWORD.lastIndex = 0;
  for (let m = LABEL_KEYWORD.exec(lower); m !== null; m = LABEL_KEYWORD.exec(lower)) {
    const next = label[m.index + m[0].length];
    if (next === undefined || !/[a-z]/.test(next)) return true;
  }
  return false;
}

const CURL_USERPASS = /((?:-u|--user)\s+[^\s:]{1,64}:)([^\s]{1,256})/g;

const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]{1,30}:\/\/[^\s:@/?#]{0,128}:)[^\s@/?#]{1,256}(?=@)/gi;

const SLACK_WEBHOOK = /(hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9_/-]{8,512}/gi;

const DOCKER_AUTH = new RegExp(String.raw`(${QUOTE}auth${QUOTE}\s*:\s*${QUOTE})([A-Za-z0-9+/]{8,4096}={0,2})(?=${QUOTE})`, "g");
const NETRC_PASSWORD =
  /(\b(?:machine|login)[ \t]+\S{1,256}\s{1,64}(?:(?:login|account)[ \t]+\S{1,256}\s{1,64})?password[ \t]+)\S{1,256}/g;
const KUBE_CLIENT_KEY = new RegExp(String.raw`((?:${QUOTE})?client-key-data(?:${QUOTE})?\s*:\s*(?:${QUOTE})?)[A-Za-z0-9+/]{8,16384}={0,2}`, "g");

// Private JWK fields. Names this short are common elsewhere, so they are only redacted
// inside an object that has "kty".
const FLAT_OBJECT = /\{[^{}]{1,65536}\}/g;
const JWK_TYPE = new RegExp(String.raw`${QUOTE}kty${QUOTE}\s*:`);
const JWK_PRIVATE = new RegExp(String.raw`(${QUOTE}(?:d|p|q|dp|dq|qi|k)${QUOTE}\s*:\s*${QUOTE})[A-Za-z0-9_-]{8,16384}`, "g");

function isBase64UserPassword(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const text = Buffer.from(value, "base64").toString("latin1");
  return /^[\x20-\x7e]{1,256}:[\x20-\x7e]{1,1024}$/.test(text);
}

// Keep the length limits. Without them this regex gets very slow on long text.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

// Separators are required so plain 10-digit ids and token counts aren't taken for phone numbers.
const PHONE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;

// Numbers like +44 20 7946 0958. Requiring the + and separate groups keeps out time
// offsets like +05:30 and amounts like +44.50.
const INTL_PHONE = /(?<![\w+])\+\d{1,3}(?:[ .-]\(?\d{1,5}\)?){2,6}(?!\w)/g;

function isPhoneLength(match: string): boolean {
  const digits = match.replace(/\D/g, "").length;
  return digits >= 9 && digits <= 15;
}

// Card numbers start with 2 to 6. Millisecond timestamps and snowflake ids start with 1,
// and one in ten of them would pass the Luhn check.
const CARD_CANDIDATE = /(?<!\d)[2-6](?:[ -]?\d){12,18}(?!\d)/g;

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

/** Redacts secrets only, without stripping control characters. */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of TOKEN_PATTERNS) {
    p.lastIndex = 0;
    out = out.replace(p, REDACTED);
  }
  out = out.replace(AUTH_SCHEME, (m, prefix, credential) => (credentialShaped(credential) ? `${prefix}${REDACTED}` : m));
  out = out.replace(LABELED_SECRET, (m, prefix) => (namesSecret(prefix) ? `${prefix}${REDACTED}` : m));
  out = out.replace(CURL_USERPASS, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(URL_PASSWORD, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(SLACK_WEBHOOK, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(DOCKER_AUTH, (m, prefix, value) => (isBase64UserPassword(value) ? `${prefix}${REDACTED}` : m));
  out = out.replace(NETRC_PASSWORD, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(KUBE_CLIENT_KEY, (_m, prefix) => `${prefix}${REDACTED}`);
  if (out.includes("kty")) {
    out = out.replace(FLAT_OBJECT, (obj) => (JWK_TYPE.test(obj) ? obj.replace(JWK_PRIVATE, (_m, prefix) => `${prefix}${REDACTED}`) : obj));
  }
  return out;
}

export function redactString(input: string, pii: boolean = true): string {
  if (!input) return input;
  let out = redactSecrets(stripControl(input));
  if (pii) {
    out = out.replace(EMAIL, "«email»");
    // Run this before PHONE, or it would grab the last ten digits of a number like +49 30 123 456 7890.
    out = out.replace(INTL_PHONE, (m) => (isPhoneLength(m) ? "«phone»" : m));
    out = out.replace(PHONE, "«phone»");
    out = out.replace(CARD_CANDIDATE, (m) => {
      const digits = m.replace(/[ -]/g, "");
      return passesLuhn(digits) ? "«card»" : m;
    });
  }
  return out;
}
