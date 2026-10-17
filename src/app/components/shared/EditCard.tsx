import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shrnutí položky s odkazem na její vlastní úpravu: pacient v úpravě zákroku,
// zákroky v úpravě pacienta. `children` jsou další akce před „Upravit“ (třeba odebrat).
export function EditCard({
  title,
  subtitle,
  edit,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  edit?: { href: string; label: string; icon: React.ReactNode };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-background p-5 md:p-6">
      <div className="min-w-0">
        <div className="truncate text-base font-medium">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
      </div>
      {(edit || children) && (
        <div className="-mr-1 flex shrink-0 items-center gap-1">
          {children}
          {edit && (
            <Link
              href={edit.href}
              aria-label={edit.label}
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "h-11 rounded-full px-4 text-base",
              )}
            >
              {edit.icon}
              Upravit
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
