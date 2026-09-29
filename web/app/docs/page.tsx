import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import Docs from "@/components/Docs";

export const metadata = {
  title: "costcatch — docs",
  description:
    "Every costcatch command with its real terminal output: run, watch, show, replay, diff, stats, estimate, clean, init — plus run flags, CI gates, exit codes, the trace format and the warning engine.",
};

export default function DocsPage() {
  return (
    <>
      <header className="site-header">
        <SiteNav />
      </header>
      <main id="content">
        <Docs />
      </main>
      <SiteFooter />
    </>
  );
}
