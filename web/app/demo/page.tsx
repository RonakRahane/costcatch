import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { ConsoleWindow } from "@/components/Console";

export const metadata = {
  title: "costcatch — demo",
  description:
    "All nine costcatch commands, each with the output it printed for one demo agent: run, show, diff, stats, estimate, watch, replay, clean and init.",
};

export default function DemoPage() {
  return (
    <>
      <header className="site-header">
        <SiteNav />
      </header>

      <main id="content">
        <section className="band">
          <div className="canvas">
            <div className="plate">
              <div className="plate-rail">
                <div className="plate-no">00</div>
                <div className="plate-name">the demo</div>
              </div>

              <div className="plate-body">
                <div className="label on">
                  <span className="sig" aria-hidden />
                  real output
                </div>

                <h1 className="h1" style={{ marginTop: 18, maxWidth: "26ch" }}>
                  Every command, <em>one agent.</em>
                </h1>

                <p className="lede">
                  Each pane is what the costcatch CLI printed for the same project. Pick a command
                  in the list.
                </p>

                <ConsoleWindow />

                <div className="note">
                  <b>The agent</b> is a Python on-call assistant that reads a log, looks up a
                  ticket and files a summary. Its first version keeps retrying a ticket that does
                  not exist, gets rate-limited, runs out of tokens and crashes. <code>diff</code>,{" "}
                  <code>watch</code> and <code>replay</code> show the fixed version. It talks to a
                  local test API, not a real provider.
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
