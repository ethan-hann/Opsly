import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import { useParams } from "wouter";
import {
  useGetInvitationPreview,
  useAcceptOrgInvitation,
  useDeclineOrgInvitation,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/auth-web";
import { Activity, AlertTriangle, CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">{t('invite.loading')}</p>
      </div>
    </div>
  );
}

function ErrorScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">{t('invite.notFoundTitle')}</h2>
        <p className="text-muted-foreground">
          {t('invite.notFoundDesc')}
        </p>
        <a href={import.meta.env.BASE_URL}>
          <Button variant="outline">{t('invite.goHome')}</Button>
        </a>
      </div>
    </div>
  );
}

function AcceptedScreen({ orgName }: { orgName: string }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => window.location.replace(import.meta.env.BASE_URL), 1800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <CheckCircle className="w-12 h-12 text-primary mx-auto" />
        <h2 className="text-xl font-bold">{t('invite.welcomeTitle', { orgName })}</h2>
        <p className="text-muted-foreground">{t('invite.takingYouToDashboard')}</p>
      </div>
    </div>
  );
}

function DeclinedScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-bold">{t('invite.declinedTitle')}</h2>
        <p className="text-muted-foreground">{t('invite.declinedDesc')}</p>
        <a href={import.meta.env.BASE_URL}>
          <Button variant="outline">{t('invite.goHome')}</Button>
        </a>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvitePage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, isLoading: authLoading, login, loginMethod } = useAuth();
  const { toast } = useToast();
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerFirstName, setRegisterFirstName] = useState("");
  const [registerLastName, setRegisterLastName] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

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
          title: t('invite.acceptError'),
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
          title: t('invite.declineError'),
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  if (isLoading || authLoading) return <LoadingScreen />;
  if (isError || !preview) return <ErrorScreen />;
  if (result === "accepted") return <AcceptedScreen orgName={preview.orgName} />;
  if (result === "declined") return <DeclinedScreen />;

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setRegisterError("Missing invitation token.");
      return;
    }
    setIsRegistering(true);
    setRegisterError(null);
    try {
      const response = await fetch("/api/auth/local/register-invite", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token,
          password: registerPassword,
          firstName: registerFirstName || undefined,
          lastName: registerLastName || undefined,
          returnTo: window.location.pathname,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setRegisterError(payload.error ?? `Registration failed (HTTP ${response.status})`);
        return;
      }

      window.location.reload();
    } finally {
      setIsRegistering(false);
    }
  }

  const expiresDate = new Date(preview.expiresAt).toLocaleDateString(i18n.language || undefined, {
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
            <h1 className="text-2xl font-bold tracking-tight">Opsly</h1>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('invite.title')}</CardTitle>
            <CardDescription>{t('invite.desc')}</CardDescription>
          </CardHeader>

          <CardContent>
            <div className="rounded-md bg-primary/10 border border-primary/20 p-4 text-center">
              <p className="font-semibold text-lg text-foreground">{preview.orgName}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('invite.expires', { date: expiresDate })}</p>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            {!isAuthenticated ? (
              <>
                {loginMethod === "password" ? (
                  <div className="w-full space-y-3">
                    <form className="space-y-3" onSubmit={handleRegister}>
                      <Input
                        type="password"
                        value={registerPassword}
                        onChange={(event) => setRegisterPassword(event.target.value)}
                        placeholder={t('auth.passwordPlaceholder')}
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                      <Input
                        type="text"
                        value={registerFirstName}
                        onChange={(event) => setRegisterFirstName(event.target.value)}
                        placeholder={t('auth.firstNamePlaceholder')}
                        autoComplete="given-name"
                      />
                      <Input
                        type="text"
                        value={registerLastName}
                        onChange={(event) => setRegisterLastName(event.target.value)}
                        placeholder={t('auth.lastNamePlaceholder')}
                        autoComplete="family-name"
                      />
                      {registerError ? (
                        <p className="text-xs text-destructive">{registerError}</p>
                      ) : null}
                      <Button className="w-full" type="submit" disabled={isRegistering}>
                        {isRegistering ? t('auth.signingIn') : t('auth.createAccount')}
                      </Button>
                    </form>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => login(window.location.pathname)}
                    >
                      {t('auth.logIn')}
                    </Button>
                    <p className="text-xs text-center text-muted-foreground">
                      {t('invite.redirectAfterSignIn')}
                    </p>
                  </div>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      onClick={() => login(window.location.pathname)}
                    >
                      {t('auth.logIn')}
                    </Button>
                    <p className="text-xs text-center text-muted-foreground">
                      {t('invite.redirectAfterSignIn')}
                    </p>
                  </>
                )}
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
                    t('invite.decline')
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
                    t('invite.accept')
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
