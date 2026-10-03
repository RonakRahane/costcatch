import { RUN_WARNINGS } from "@/data/site-captures";

// A card shows no quote if its code isn't in RUN_WARNINGS, so keep the codes in sync with the demo run.

const FINDINGS: { code: string; title: string; body: string }[] = [
  {
    code: "http_error",
    title: "Failed calls",
    body: "Rate limits, server errors and dropped connections, with the provider's own message.",
  },
  {
    code: "tool_loop",
    title: "Tool loops",
    body: "The same tool, called with the same arguments, three times or more.",
  },
  {
    code: "large_tool_result",
    title: "Oversized tool results",
    body: "One big result, paid for again in every call after it.",
  },
  {
    code: "truncated_output",
    title: "Cut-off answers",
    body: "The model hit its token limit, so the answer is incomplete.",
  },
  {
    code: "retry",
    title: "Retries",
    body: "The same prompt sent again, often by your SDK, without telling you.",
  },
  {
    code: "unanswered_tool_call",
    title: "Lost tool results",
    body: "Your program stopped before a tool's result got back to the model.",
  },
];

const README_CHECKS = "https://github.com/RonakRahane/costcatch#what-it-catches";

export default function Findings() {
  return (
    <section className="band" id="finds">
      <div className="canvas">
        <div className="plate">
          <div className="plate-rail">
            <div className="plate-no">02</div>
            <div className="plate-name">what it finds</div>
          </div>

          <div className="plate-body">
            <h2 className="h2">
              Most agent bugs don&apos;t crash. <em>They cost you.</em>
            </h2>

            <p className="lede">
              Your agent can finish and still waste money. costcatch checks every run for 15 kinds
              of problems and names the step.
            </p>

            <div className="finds">
              {FINDINGS.map((f) => {
                const w = RUN_WARNINGS.find((x) => x.code === f.code);
                return (
                  <div className="find" key={f.code}>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                    {w ? (
                      <div className={`find-line ${w.severity === "critical" ? "bad" : "warn"}`}>
                        <span aria-hidden>●</span> {w.message}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <p className="seealso">
              <a href={README_CHECKS} target="_blank" rel="noopener noreferrer">
                All 15 checks, and what each one means ↗
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
