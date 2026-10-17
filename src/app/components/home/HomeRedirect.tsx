"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageSkeleton } from "@/app/components/shared/LoadingStates";
import { api } from "@/lib/api/client";
import type { Session } from "@/lib/api/types";
import { homeOf } from "@/lib/roles";

export function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    api
      .get<Session>("/api/auth/session")
      .then((session) => router.replace(homeOf(session.role)))
      .catch(() => router.replace("/login"));
  }, [router]);
  return <PageSkeleton />;
}
