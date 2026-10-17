"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Potvrzení před změnou, kterou ponese jméno lékaře (potvrzení údaje z dokumentu i jeho odvolání).
// Shadcn AlertDialog, jen v našem stylu: velký nadpis, tlačítka rounded-full s plochou 44 px.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Zrušit",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-6 rounded-2xl p-6 sm:max-w-md">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold tracking-tight">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel variant="secondary" className="h-11 rounded-full px-5 text-base">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            className="h-11 rounded-full px-5 text-base"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
