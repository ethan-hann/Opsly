import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "react-i18next";

interface UnsavedChangesDialogProps {
  open: boolean;
  onLeave: () => void;
  onStay: () => void;
}

/**
 * Confirmation dialog shown when a user navigates away from a dirty form.
 * "Stay" returns to the form; "Leave" discards changes and continues navigation.
 */
export function UnsavedChangesDialog({
  open,
  onLeave,
  onStay,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onStay()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("unsavedChanges.title", {
              defaultValue: "You have unsaved changes",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("unsavedChanges.description", {
              defaultValue:
                "If you leave now, your changes will be lost. Are you sure you want to leave?",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* "Stay" is the safe action — map to AlertDialogCancel so pressing
              Escape or clicking the overlay also keeps the user on the form. */}
          <AlertDialogCancel onClick={onStay}>
            {t("unsavedChanges.stay", { defaultValue: "Stay" })}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onLeave}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("unsavedChanges.leave", { defaultValue: "Leave" })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
