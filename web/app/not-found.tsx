import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import MissedRequest from "@/components/MissedRequest";

export const metadata = {
  title: "costcatch — page not found",
};

const PLACES: { href: string; title: string; body: string; external?: boolean }[] = [
  { href: "/", title: "Home", body: "What costcatch does, on one page." },
  { href: "/docs", title: "Docs", body: "Every command and flag, with real output." },
  { href: "/demo", title: "Demo", body: "All nine commands, run on one agent." },
  { href: "https://github.com/RonakRahane/costcatch", title: "GitHub", body: "Source, issues and releases.", external: true },
];

export default function NotFound() {
  return (
    <>
      <header className="site-header">
        <SiteNav />
      </header>

      <main id="content" className="landing">
        <section className="band">
          <div className="canvas">
            <div className="plate">
              <div className="plate-rail">
                <div className="plate-no">404</div>
                <div className="plate-name">not found</div>
              </div>

              <div className="plate-body nf-body">
                <div className="label on rise">
                  <span className="sig" aria-hidden />
                  page not found
                </div>

                <h1 className="h1 nf-h1 rise" style={{ "--d": "70ms" } as React.CSSProperties}>
                  This page doesn&apos;t exist.{" "}
                  <em>
                    It cost you <span className="m">$0.00</span>.
                  </em>
                </h1>

                <p className="lede rise" style={{ "--d": "140ms" } as React.CSSProperties}>
                  The link may be old, or the page has moved. Everything costcatch has is one click
                  away.
                </p>

                <div className="rise" style={{ "--d": "210ms" } as React.CSSProperties}>
                  <MissedRequest />
                </div>

                <nav className="nf-links rise" aria-label="Pages" style={{ "--d": "280ms" } as React.CSSProperties}>
                  {PLACES.map((p) =>
                    p.external ? (
                      <a key={p.href} className="nf-link" href={p.href} target="_blank" rel="noopener noreferrer">
                        <span className="t">
                          {p.title}
                          <span className="arr" aria-hidden>
                            ↗
                          </span>
                        </span>
                        <span className="b">{p.body}</span>
                      </a>
                    ) : (
                      <Link key={p.href} className="nf-link" href={p.href}>
                        <span className="t">
                          {p.title}
                          <span className="arr" aria-hidden>
                            →
                          </span>
                        </span>
                        <span className="b">{p.body}</span>
                      </Link>
                    )
                  )}
                </nav>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
