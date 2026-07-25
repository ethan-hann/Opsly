import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('token');
  }, []);

  const signInHref = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    if (!token) {
      setError(t('auth.resetPasswordInvalid'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/local/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? `Reset failed (HTTP ${response.status})`);
        return;
      }
      setSuccess(true);
      // Redirect to login after a short delay so the user can read the success message.
      setTimeout(() => {
        window.location.href = signInHref;
      }, 2000);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center">
          <div className="w-9 h-9 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <Activity className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Opsly</span>
        </div>

        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            {t('auth.resetPasswordTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('auth.resetPasswordDesc')}
          </p>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <CheckCircle className="w-10 h-10 text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">
              {t('auth.resetPasswordSuccess')}
            </p>
          </div>
        ) : !token ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              {t('auth.resetPasswordInvalid')}
            </p>
            <a
              href={signInHref}
              className="text-sm text-primary hover:underline underline-offset-4"
            >
              {t('auth.backToSignIn')}
            </a>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.newPasswordPlaceholder')}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t('auth.confirmPasswordPlaceholder')}
              autoComplete="new-password"
              minLength={8}
              required
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
            <Button
              className="w-full"
              size="lg"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('auth.resettingPassword') : t('auth.resetPassword')}
            </Button>
            <div className="text-center">
              <a
                href={signInHref}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
              >
                {t('auth.backToSignIn')}
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
