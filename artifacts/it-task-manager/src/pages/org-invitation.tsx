import { useAcceptOrgInvitation, useDeclineOrgInvitation } from "@workspace/api-client-react";
import type { PendingInvitation } from "@workspace/api-client-react";
import { Activity, Building2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface OrgInvitationProps {
  invitation: PendingInvitation;
  onAccepted: () => void;
  onDeclined: () => void;
}

export default function OrgInvitation({ invitation, onAccepted, onDeclined }: OrgInvitationProps) {
  const { toast } = useToast();

  const { mutate: accept, isPending: isAccepting } = useAcceptOrgInvitation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation accepted", description: `Welcome to ${invitation.orgName}!` });
        onAccepted();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to accept invitation", description: err.message, variant: "destructive" });
      },
    },
  });

  const { mutate: decline, isPending: isDeclining } = useDeclineOrgInvitation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Invitation declined" });
        onDeclined();
      },
      onError: (err: Error) => {
        toast({ title: "Failed to decline invitation", description: err.message, variant: "destructive" });
      },
    },
  });

  const isPending = isAccepting || isDeclining;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mission Control</h1>
            <p className="text-muted-foreground text-sm mt-1">IT Task Manager</p>
          </div>
        </div>

        <Card>
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle>You've been invited</CardTitle>
            <CardDescription>
              You have a pending invitation to join
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-center">
              <p className="font-semibold text-lg text-foreground">{invitation.orgName}</p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                disabled={isPending}
                onClick={() => decline({ token: invitation.token })}
              >
                <X className="w-4 h-4" />
                Decline
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={isPending}
                onClick={() => accept({ token: invitation.token })}
              >
                <Check className="w-4 h-4" />
                {isAccepting ? "Joining…" : "Accept & join"}
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
