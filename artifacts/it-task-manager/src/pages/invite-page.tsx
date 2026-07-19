import { useEffect, useState } from "react";
import { useParams } from "wouter";
import {
  useGetInvitationPreview,
  useAcceptOrgInvitation,
  useDeclineOrgInvitation,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Activity, AlertTriangle, CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// ─── Sub-screens ──────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading invitation…</p>
      </div>
    </div>
  );
}

function ErrorScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Invitation not found</h2>
        <p className="text-muted-foreground">
          This invitation link is invalid or has already expired.
        </p>
        <a href={import.meta.env.BASE_URL}>
          <Button variant="outline">Go to home</Button>
        </a>
      </div>
    </div>
  );
}

function AcceptedScreen({ orgName }: { orgName: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(import.meta.env.BASE_URL), 1800);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <CheckCircle className="w-12 h-12 text-primary mx-auto" />
        <h2 className="text-xl font-bold">Welcome to {orgName}!</h2>
        <p className="text-muted-foreground">Taking you to your dashboard…</p>
      </div>
    </div>
  );
}

function DeclinedScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-bold">Invitation declined</h2>
        <p className="text-muted-foreground">You have declined this invitation.</p>
        <a href={import.meta.env.BASE_URL}>
          <Button variant="outline">Go to home</Button>
        </a>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);

  const {
    data: preview,
    isLoading,
    isError,
  } = useGetInvitationPreview(token ?? "");

  const { mutate: accept, isPending: isAccepting } = useAcceptOrgInvitation({
    mutation: {
      onSuccess: () => setResult("accepted"),
      onError: (err: Error) =>
        toast({
          title: "Couldn't accept invitation",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const { mutate: decline, isPending: isDeclining } = useDeclineOrgInvitation({
    mutation: {
      onSuccess: () => setResult("declined"),
      onError: (err: Error) =>
        toast({
          title: "Couldn't decline invitation",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  if (isLoading || authLoading) return <LoadingScreen />;
  if (isError || !preview) return <ErrorScreen />;
  if (result === "accepted") return <AcceptedScreen orgName={preview.orgName} />;
  if (result === "declined") return <DeclinedScreen />;

  const expiresDate = new Date(preview.expiresAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
            <p className="text-muted-foreground text-sm mt-1">Opsly</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>You've been invited</CardTitle>
            <CardDescription>You have a pending invitation to join an organization.</CardDescription>
          </CardHeader>

          <CardContent>
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4 text-center">
              <p className="font-semibold text-lg text-foreground">{preview.orgName}</p>
              <p className="text-xs text-muted-foreground mt-1">Expires {expiresDate}</p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            {!isAuthenticated ? (
              <>
                <a
                  href={`/api/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
                  className="w-full"
                >
                  <Button className="w-full">Log in to accept invitation</Button>
                </a>
                <p className="text-xs text-center text-muted-foreground">
                  You'll be redirected back here after signing in.
                </p>
              </>
            ) : (
              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={isDeclining || isAccepting}
                  onClick={() => decline({ token: token! })}
                >
                  {isDeclining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Decline"
                  )}
                </Button>
                <Button
                  className="flex-1"
                  disabled={isAccepting || isDeclining}
                  onClick={() => accept({ token: token! })}
                >
                  {isAccepting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Accept invitation"
                  )}
                </Button>
              </div>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
