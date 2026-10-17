import { KlidkaLogo } from "@/app/components/login/KlidkaLogo";

// Stránka z pozvánky pomocníka z rodiny: bez přihlášení, jednoduchý rám s logem a jedním sloupcem.
export default function HelperLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col bg-background pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-md flex-col gap-10 px-4 pt-8 pb-12 lg:max-w-xl lg:pt-12">
        <KlidkaLogo />
        {children}
      </div>
    </main>
  );
}
