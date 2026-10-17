import { HelperInvite } from "@/app/components/patient/HelperInvite";

// Obsah je za přihlášením (RoleGate v layoutu) a pozvánku vytváří klient přes API, okamžitá navigace se tu nečeká.
export const instant = false;

// Pozvání pomocníka z rodiny. Pomocník sem projde layoutem taky, pozvat ale nesmí (hlídá API, stránka mu to jen řekne).
export default function HelperInvitePage() {
  return <HelperInvite />;
}
