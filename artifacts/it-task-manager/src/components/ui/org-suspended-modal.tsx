/**
 * OrgSuspendedModal
 *
 * A non-closable modal that appears when the user's organization is suspended.
 * Escape key, outside-click, and the backdrop are all blocked — the user's
 * only action is to sign out.
 *
 * Kept as a pure presentational component (no internal auth calls) so it can
 * be rendered from any point in the tree and tested in full isolation.
 */
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

export interface OrgSuspendedModalProps {
  open: boolean;
  onSignOut: () => void;
}

export function OrgSuspendedModal({ open, onSignOut }: OrgSuspendedModalProps) {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-background p-8 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <DialogPrimitive.Title className="text-2xl font-bold">
              {t("orgSuspended.title")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-muted-foreground text-sm">
              {t("orgSuspended.desc")}
            </DialogPrimitive.Description>
            <Button variant="outline" onClick={onSignOut}>
              {t("orgSuspended.signOut")}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
