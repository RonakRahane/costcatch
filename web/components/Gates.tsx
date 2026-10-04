import Verbatim from "./Verbatim";
import { SITE_CAPTURES } from "@/data/site-captures";

const WORKFLOW = `- name: Agent test
  run: npx costcatch --max-cost 0.05 --max-errors 0 python tests/agent_test.py`;

const GATES: { flag: string; when: React.ReactNode; checked: string }[] = [
  { flag: "--max-cost <usd>", when: "the run cost more than this", checked: "at the end" },
  { flag: "--max-calls <n>", when: "it made more LLM calls than this", checked: "at the end" },
  { flag: "--max-errors <n>", when: "failed calls and failed tools add up to more than this", checked: "at the end" },
  { flag: "--budget <usd>", when: <>spend passes this, so the program is <em>stopped</em></>, checked: "while it runs" },
];

export default function Gates() {
  const { gates, budget } = SITE_CAPTURES;

  return (
    <section className="band" id="ci">
      <div className="canvas">
        <div className="plate">
          <div className="plate-rail">
            <div className="plate-no">05</div>
            <div className="plate-name">ci</div>
          </div>

          <div className="plate-body">
            <h2 className="h2">
              Fail the build when your agent <em>gets worse.</em>
            </h2>

            <p className="lede">
              Run your agent&apos;s test under costcatch. The job fails when a run costs too much,
              makes too many calls, or hits errors.
            </p>

            <div className="split ci-setup">
              <div className="file">
                <div className="file-head">
                  <span>.github/workflows/agent.yml</span>
                  <span className="tag">one step</span>
                </div>
                <pre>
                  <code>{WORKFLOW}</code>
                </pre>
              </div>

              <table className="tbl gates">
                <thead>
                  <tr>
                    <th>flag</th>
                    <th>fails when</th>
                    <th>checked</th>
                  </tr>
                </thead>
                <tbody>
                  {GATES.map((g) => (
                    <tr key={g.flag}>
                      <td>
                        <code>{g.flag}</code>
                      </td>
                      <td>{g.when}</td>
                      <td className={g.checked === "while it runs" ? "warn" : "dim"}>{g.checked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Verbatim command={gates.command} output={gates.output} exitCode={gates.exitCode} note="last lines" />

            <h3 className="h3 sub">Stop a runaway agent</h3>
            <p className="prose">
              <code>--budget</code> stopped this run after 4 of its 6 calls. The last two were never
              sent, so they were never billed.
            </p>
            <Verbatim command={budget.command} output={budget.output} exitCode={budget.exitCode} note="last lines" />

            <div className="note">
              <b>A gate that can&apos;t be checked fails.</b> If a model has no known price,{" "}
              <code>--max-cost</code> fails instead of passing.
            </div>

            <p className="seealso">
              <a href="https://github.com/RonakRahane/costcatch#use-it-in-ci" target="_blank" rel="noopener noreferrer">
                More on CI, JSON output and exit codes ↗
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
