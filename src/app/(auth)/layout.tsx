import { Reveal } from "@/app/components/shared/motion/Reveal";
import { BrandPanel } from "@/app/components/login/BrandPanel";
import { KlidkaLogo } from "@/app/components/login/KlidkaLogo";

// Telefon: nahoře logo a přihlášení, pod tím panel značky s animacemi.
// Desktop: vlevo panel (logo je v něm), vpravo formulář. Čtečka čte formulář jako první.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col pt-safe pb-safe">
      <div className="flex flex-1 flex-col gap-2 p-2 lg:grid lg:grid-cols-2 lg:gap-0 lg:p-3">
        <Reveal delay={0.1} className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 px-4 py-8 lg:col-start-2 lg:row-start-1 lg:py-12">
          <KlidkaLogo className="lg:hidden" />
          {children}
        </Reveal>
        <BrandPanel />
      </div>
    </main>
  );
}
