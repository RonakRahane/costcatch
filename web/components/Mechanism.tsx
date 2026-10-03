import Link from "next/link";

const STEPS: { head: string; body: React.ReactNode; cmd?: string }[] = [
  {
    head: "Run it",
    cmd: "costcatch python agent.py",
    body: <>Put costcatch in front of the command you already use. Your program, its flags and its output stay the same.</>,
  },
  {
    head: "It watches the calls",
    body: (
      <>
        A small hook inside your program copies each LLM request and response as it passes. It
        never changes them.
      </>
    ),
  },
  {
    head: "You get the trace",
    body: (
      <>
        Every call is priced and checked for problems. You see it live while the agent runs, and
        in full when it ends.
      </>
    ),
  },
];

const PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Gemini",
  "Azure OpenAI",
  "Vertex AI",
  "OpenRouter",
  "Groq",
  "Mistral",
  "Cohere",
  "Ollama",
];

const LIBRARIES = ["OpenAI SDK", "Anthropic SDK", "LangChain", "LiteLLM", "CrewAI", "requests", "httpx", "fetch"];

export default function Mechanism() {
  return (
    <section className="band" id="how">
      <div className="canvas">
        <div className="plate">
          <div className="plate-rail">
            <div className="plate-no">03</div>
            <div className="plate-name">how it works</div>
          </div>

          <div className="plate-body">
            <h2 className="h2">
              Works with the agent <em>you already have.</em>
            </h2>

            <p className="lede">
              costcatch reads the calls your agent sends over the network, below any SDK or
              framework. Nothing to import, wrap or configure.
            </p>

            <div className="steps">
              {STEPS.map((s, i) => (
                <div className="step-cell" key={s.head}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{s.head}</h3>
                  {s.cmd ? (
                    <code className="step-cmd">
                      <span className="p" aria-hidden>
                        $
                      </span>{" "}
                      {s.cmd}
                    </code>
                  ) : null}
                  <p>{s.body}</p>
                </div>
              ))}
            </div>

            <dl className="stack">
              <div>
                <dt>providers</dt>
                <dd>
                  {PROVIDERS.map((p) => (
                    <span className="chip" key={p}>
                      {p}
                    </span>
                  ))}
                  <span className="chip more">any OpenAI-compatible API</span>
                </dd>
              </div>
              <div>
                <dt>libraries</dt>
                <dd>
                  {LIBRARIES.map((l) => (
                    <span className="chip" key={l}>
                      {l}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>

            <div className="note">
              <b>If costcatch fails, your agent doesn&apos;t.</b> It only watches, so a problem inside
              costcatch means a missing trace, never a broken run. It never reads request headers,
              where your API keys live.
            </div>

            <p className="seealso">
              <Link href="/docs#internals">How interception works</Link>
              <span className="faint">·</span>
              <Link href="/docs#security">Security</Link>
              <span className="faint">·</span>
              <Link href="/docs#limits">Limitations</Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
