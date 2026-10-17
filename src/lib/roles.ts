import type { Role } from "@/lib/api/types";

// Kam patří kdo po přihlášení. Sdílí server (requireRole v layoutu) i klient (přihlášení).
// Pomocník z rodiny jde do pacientské části (za svého pacienta).
export const homeOf = (role: Role) => (role === "aa" ? "/staff" : "/patient");
