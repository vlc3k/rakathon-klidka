import { Reveal } from "@/app/components/shared/motion/Reveal";
import { KlidkaLogo } from "@/app/components/login/KlidkaLogo";
import { VfnLogo } from "@/app/components/login/VfnLogo";
import { AdamParallax } from "@/app/components/login/AdamParallax";

// Panel značky Klidka u přihlášení: Stvoření Adama se štafetou, ruka ambulance podává kolík ze srolované zprávy (kampaň „Svůj úsek“, docs/brain/10-rozhodnuti.md).
// Pacient papír od lékaře sežene a vyfotí (svůj úsek), od té chvíle ho nese ambulance. Fotka je vygenerovaná, žádný skutečný pacient.
// Text je inkoustový na korálové (kontrast 4,8 : 1, jen velké písmo). Na telefonu je panel pod formulářem,
// na desktopu levá polovina obrazovky.
export function BrandPanel() {
  return (
    <section className="relative isolate flex h-96 flex-col justify-between overflow-hidden rounded-3xl bg-[#e0674c] p-6 text-[#1f1d24] lg:col-start-1 lg:row-start-1 lg:h-auto lg:p-12">
      <AdamParallax className="absolute inset-0 -z-10" />

      {/* Text nahoře nad rukama, kde je čistá korálová. Na telefonu je logo nad přihlášením, tady jen na desktopu.
          Tečka loga je na korálové bílá, jinak by zmizela. */}
      <Reveal delay={0.15} className="flex flex-col gap-3">
        <KlidkaLogo className="mb-6 hidden lg:flex lg:mb-10 [&_.text-brand-dot]:text-white" />
        <p className="max-w-[12ch] [font-family:var(--font-display)] text-5xl leading-[0.92] font-extrabold uppercase text-balance sm:text-6xl lg:text-8xl">
          Vy běžíte jen <span className="text-white">svůj úsek.</span>
        </p>
        <p className="hidden max-w-[32ch] text-lg leading-snug font-medium sm:block lg:text-xl">Napíšeme vám, který podklad chybí a kde ho získat. Vy ho vyfotíte, dál ho převezmeme my.</p>
      </Reveal>

      {/* Logo VFN na bílé destičce: na korálové by jeho modrá a název ztrácely kontrast. */}
      <div className="self-start rounded-2xl bg-white px-4 py-3 lg:px-5 lg:py-4">
        <VfnLogo className="h-11 lg:h-14" />
      </div>
    </section>
  );
}
