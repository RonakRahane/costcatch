import SiteNav from "@/components/SiteNav";
import Hero from "@/components/Hero";
import Findings from "@/components/Findings";
import Mechanism from "@/components/Mechanism";
import Console from "@/components/Console";
import Gates from "@/components/Gates";
import Close from "@/components/Close";
import SiteFooter from "@/components/SiteFooter";

export default function Home() {
  return (
    <>
      <header className="site-header">
        <SiteNav />
      </header>

      <main id="content" className="landing">
        <Hero />
        <Findings />
        <Mechanism />
        <Console />
        <Gates />
        <Close />
      </main>

      <SiteFooter />
    </>
  );
}
