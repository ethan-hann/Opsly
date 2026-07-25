import { useAuth } from '@workspace/replit-auth-web';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Activity, Shield, Zap, BarChart3, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguagePicker } from '@/components/ui/language-picker';
import { type FormEvent, useMemo, useState } from 'react';

export default function LoginPage() {
  const { login, loginMethod, loginWithPassword } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnTo = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const value = new URLSearchParams(window.location.search).get('returnTo');
    return value && value.startsWith('/') && !value.startsWith('//')
      ? value
      : undefined;
  }, []);

  const features = [
    { icon: Shield, labelKey: 'auth.incidentTracking', descKey: 'auth.incidentTrackingDesc' },
    { icon: Zap, labelKey: 'auth.deploymentManagement', descKey: 'auth.deploymentManagementDesc' },
    { icon: BarChart3, labelKey: 'auth.projectVisibility', descKey: 'auth.projectVisibilityDesc' },
    { icon: MessageSquareText, labelKey: 'auth.teamCoordination', descKey: 'auth.teamCoordinationDesc' },
  ] as const;

  async function handleLocalLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await loginWithPassword(email, password, returnTo);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.href = returnTo ?? import.meta.env.BASE_URL;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-card border-r border-border p-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <Activity className="w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">Opsly</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight leading-tight">
              {t('auth.itOperationsTitle')}
            </h1>
            <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
              {t('auth.itOperationsDesc')}
            </p>
          </div>

          <div className="space-y-4">
            {features.map(({ icon: Icon, labelKey, descKey }) => (
              <div key={labelKey} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-md border border-border bg-background flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{t(labelKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Opsly - v1.0
        </p>
      </div>

      {/* Right panel - login */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 justify-center">
            <div className="w-9 h-9 rounded bg-primary flex items-center justify-center text-primary-foreground">
              <Activity className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">Opsly</span>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">{t('auth.signIn')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('auth.accessDashboard')}
            </p>
          </div>

          <div className="space-y-4">
            {loginMethod === 'password' ? (
              <form className="space-y-3" onSubmit={handleLocalLogin}>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  autoComplete="email"
                  required
                />
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  autoComplete="current-password"
                  required
                />
                {error ? (
                  <p className="text-xs text-destructive">{error}</p>
                ) : null}
                <Button
                  className="w-full"
                  size="lg"
                  type="submit"
                  data-testid="button-login"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t('auth.signingIn') : t('auth.logIn')}
                </Button>
              </form>
            ) : (
              <Button
                className="w-full"
                size="lg"
                onClick={() => login(returnTo)}
                data-testid="button-login"
              >
                {t('auth.logIn')}
              </Button>
            )}
            <p className="text-xs text-center text-muted-foreground">
              {t('auth.authSecure')}
            </p>
          </div>

          <div className="flex justify-center">
            <LanguagePicker />
          </div>
        </div>
      </div>
    </div>
  );
}
