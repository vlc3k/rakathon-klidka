import "server-only";
import { after } from "next/server";

// Práce po odeslání odpovědi (Next.js after): klient nečeká, server ji dokončí sám.
// Mimo požadavek (testy, skripty) after nejde zavolat, práce se pak jen spustí bez čekání.
// Chyba se zaloguje, klient už odpověď má; stav (failed) si práce zapisuje sama.
export function runAfterResponse(label: string, task: () => Promise<unknown>) {
  const run = () =>
    task().catch((error: unknown) => {
      console.error(JSON.stringify({ event: "background.failed", label, message: error instanceof Error ? error.message : String(error) }));
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
