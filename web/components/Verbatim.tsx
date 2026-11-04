import localFont from "next/font/local";

// Shows a terminal capture as printed and colours it here, so the capture strings stay plain text.
// Box alignment depends on every space, so the output must never reflow.

// IBM Plex Mono's web subset does not include the box-drawing glyphs used by the
// captures. PT Mono does, so loading it here prevents a browser-specific fallback
// font from shifting individual lines out of alignment.
const terminal = localFont({
  src: "../app/fonts/PTMono-Regular.ttf",
  variable: "--font-terminal",
  display: "swap",
  weight: "400",
});

type Severity = "critical" | "warn" | "info";

const SEVERITY_CLASS: Record<Severity, string> = { critical: "c-bad", warn: "c-warn", info: "c-dim" };

const TOKENS =
  /([△∆][^│]*?)(?=\s*│|\s*$)|(→→ retry of step \d+)|(failed:)|(HTTP \d{3})|(✓|✔)|(✗|✘|✖)|(\$\??[\d?.,]*(?:\/mo)?)|(--[a-z][a-z-]*)|(\[(?:warn|info|critical)\])|([█▓▒░]+)|([─│┌┐└┘├┤┬┴┼╭╮╰╯═║╔╗╚╝╠╣╦╩╬▄▀]+)|(\/\/.*$)|(△|∆|●|✦|◦|⚡|📊|⧗|▸|▴|⟳|·|→)/g;

// Matches a warning row inside a box, like "│ ● message   │".
const WARNING = /^(│ )(● .*?)(\s*│)$/;

// These glyphs are not in PT Mono. Keep each replacement one character wide,
// which preserves the original terminal column positions without using a fallback font.
function terminalText(text: string) {
  return text.replaceAll("✓", "+").replaceAll("✗", "×").replaceAll("▸", ">");
}

function paint(line: string, key: number) {
  // Block characters are either a cost bar or the init banner's wordmark.
  // Only bar lines also show a dollar amount, so that tells them apart.
  const barsAreCost = line.includes("$");
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of line.matchAll(TOKENS)) {
    const at = m.index ?? 0;
    if (at > last) out.push(terminalText(line.slice(last, at)));

    const [text, caution, retry, failed, http, ok, bad, money, flag, sev, bar, box, comment] = m;
    const cls =
      caution || retry
        ? "c-warn"
        : failed || http || bad
          ? "c-bad"
          : ok
            ? "c-ok"
            : money
              ? "c-money"
              : flag
                ? "c-key"
                : sev
                  ? sev === "[critical]"
                    ? "c-bad"
                    : sev === "[info]"
                      ? "c-dim"
                      : "c-warn"
                  : bar
                    ? barsAreCost
                      ? "c-bar"
                      : "c-mark"
                    : box
                      ? "c-box"
                      : comment
                        ? "c-comment"
                        : "c-dim";

    out.push(
      <span className={cls} key={`${key}-${i++}`}>
        {terminalText(text)}
      </span>
    );
    last = at + text.length;
  }

  if (last < line.length) out.push(terminalText(line.slice(last)));
  return out;
}

export default function Verbatim({
  command,
  output,
  exitCode = 0,
  note,
  severities,
}: {
  command: string;
  output: string;
  exitCode?: number;
  note?: string;
  /** Severity of each warning row in printed order. Rows without one are shown as warnings. */
  severities?: Severity[];
}) {
  const lines = output.replace(/\n+$/, "").split("\n");

  const warningClass: (string | null)[] = [];
  let inWarnings = false;
  let warningRow = 0;
  for (const l of lines) {
    if (l.includes("── warnings")) inWarnings = true;
    else if (l.startsWith("└")) inWarnings = false;
    warningClass.push(inWarnings && WARNING.test(l) ? SEVERITY_CLASS[severities?.[warningRow++] ?? "warn"] : null);
  }

  return (
    <figure className={`capture ${terminal.variable}`}>
      <div className="capture-head">
        <span>captured output</span>
        {note ? <span className="dim">{note}</span> : null}
        <span className="spacer" />
        <span className={`exit${exitCode === 0 ? "" : " bad"}`}>exit {exitCode}</span>
      </div>
      <div className="capture-body">
        <div className="term-cmd" style={{ borderRadius: 0 }}>
          <span className="p" aria-hidden>
            $
          </span>
          <code>{command}</code>
        </div>
        <pre className="verbatim">
          {lines.map((l, i) => {
            const cls = warningClass[i];
            const row = cls ? WARNING.exec(l) : null;
            return (
              <span key={i}>
                {row && cls ? (
                  <>
                    <span className="c-box">{terminalText(row[1].trimEnd())}</span>{" "}
                    <span className={cls}>{terminalText(row[2])}</span>
                    {terminalText(row[3].slice(0, -1))}
                    <span className="c-box">│</span>
                  </>
                ) : (
                  paint(l, i)
                )}
                {i < lines.length - 1 ? "\n" : null}
              </span>
            );
          })}
        </pre>
      </div>
    </figure>
  );
}
