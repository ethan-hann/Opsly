import { useAuth } from '@workspace/replit-auth-web';
import { Button } from '@/components/ui/button';
import { Activity, Shield, Zap, BarChart3, MessageSquareText } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();

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
              IT Operations, under control.
            </h1>
            <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
              Track incidents, manage deployments, and coordinate projects - all in one place built for hobbyists, powerful enough for engineering teams.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: Shield, label: 'Incident Tracking', desc: 'Triage and resolve critical issues fast' },
              { icon: Zap, label: 'Deployment Management', desc: 'Monitor and coordinate releases end-to-end' },
              { icon: BarChart3, label: 'Project Visibility', desc: 'Real-time progress across all workstreams' },
              { icon: MessageSquareText, label: 'Team Coordination', desc: 'Communicate and collaborate effectively' }
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-md border border-border bg-background flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
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
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Access your IT operations dashboard
            </p>
          </div>

          <div className="space-y-4">
            <Button
              className="w-full"
              size="lg"
              onClick={login}
              data-testid="button-login"
            >
              Log in
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Authentication is handled securely.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
