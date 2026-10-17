import { HomeRedirect } from "@/app/components/home/HomeRedirect";

// Úvod: přihlášený jde rovnou do své části, ostatní na přihlášení.
export default function Home() {
  return (
    <main className="flex-1 bg-muted pt-safe pb-safe">
      <HomeRedirect />
    </main>
  );
}
