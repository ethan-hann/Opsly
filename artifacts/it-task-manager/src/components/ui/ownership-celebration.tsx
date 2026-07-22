import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";

interface OwnershipCelebrationProps {
  open: boolean;
  onClose: () => void;
  orgName: string | null;
}

function fireConfetti() {
  const duration = 3500;
  const end = Date.now() + duration;

  // Left cannon
  const left = confetti.create(undefined, { resize: true, useWorker: true });
  // Right cannon
  const right = confetti.create(undefined, { resize: true, useWorker: true });

  const colors = ["#7c3aed", "#a78bfa", "#f59e0b", "#fbbf24", "#34d399", "#60a5fa"];

  (function frame() {
    left({
      particleCount: 4,
      angle: 55,
      spread: 70,
      origin: { x: 0, y: 0.65 },
      colors,
      scalar: 1.1,
    });
    right({
      particleCount: 4,
      angle: 125,
      spread: 70,
      origin: { x: 1, y: 0.65 },
      colors,
      scalar: 1.1,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();

  // Center burst after a short delay
  setTimeout(() => {
    confetti({
      particleCount: 120,
      spread: 100,
      origin: { x: 0.5, y: 0.55 },
      colors,
      scalar: 1.2,
      gravity: 1.1,
    });
  }, 400);
}

export function OwnershipCelebration({ open, onClose, orgName }: OwnershipCelebrationProps) {
  const { t } = useTranslation();
  const firedRef = useRef(false);

  useEffect(() => {
    if (open && !firedRef.current) {
      firedRef.current = true;
      fireConfetti();
    }
    if (!open) {
      firedRef.current = false;
    }
  }, [open]);

  const features = [
    { labelKey: "ownership.manageMembers", descKey: "ownership.manageMembersDesc" },
    { labelKey: "ownership.fullSettings", descKey: "ownership.fullSettingsDesc" },
    { labelKey: "ownership.apiKeys", descKey: "ownership.apiKeysDesc" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md text-center gap-6">
        <DialogHeader className="items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-primary/20">
            <Crown className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="text-2xl">{t('ownership.newOwnerTitle')}</DialogTitle>
          <DialogDescription className="text-base">
            {orgName ? (
              <>
                {t('ownership.newOwnerDescPre')}{" "}
                <span className="font-semibold text-foreground">{orgName}</span>
                {t('ownership.newOwnerDescPost')}
              </>
            ) : (
              <>{t('ownership.newOwnerDescNoOrg')}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 text-sm">
          {features.map(({ labelKey, descKey }) => (
            <div key={labelKey} className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
              <p className="font-medium text-foreground text-xs">{t(labelKey)}</p>
              <p className="text-muted-foreground text-xs">{t(descKey)}</p>
            </div>
          ))}
        </div>

        <Button onClick={onClose} className="w-full">
          {t('ownership.getStarted')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
