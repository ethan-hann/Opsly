import React, { useEffect, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AdminConsolePage from '@/pages/admin/index';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { useTranslation } from 'react-i18next';

import { ThemeProvider } from '@/components/theme-provider';
import { AppLayout } from '@/components/layout/app-layout';
import { OrgGuard } from '@/hooks/org-guard';
import { GlobalSearchProvider } from '@/hooks/use-global-search';
import { SseProvider } from '@/hooks/use-sse';
import { GlobalSearchPalette } from '@/components/global-search-palette';
import { TerminologyProvider } from '@/context/terminology-context';
import { BrandingProvider } from '@/context/branding-context';

import Dashboard from '@/pages/dashboard';
import ProjectsList from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import ProjectNewPage from '@/pages/project-new';
import ProjectEditPage from '@/pages/project-edit';
import TasksList from '@/pages/tasks';
import TaskDetail from '@/pages/task-detail';
import TaskNewPage from '@/pages/task-new';
import TaskEditPage from '@/pages/task-edit';
import NotesPage from '@/pages/notes';
import LoginPage from '@/pages/login';
import OrgOnboarding from '@/pages/org-onboarding';
import OrgInvitation from '@/pages/org-invitation';
import OrgSettings from '@/pages/org-settings';
import WebhooksPage from '@/pages/webhooks';
import WebhookInboundEditPage from '@/pages/webhook-inbound-edit';
import WebhookOutboundEditPage from '@/pages/webhook-outbound-edit';
import InvitePage from '@/pages/invite-page';
import UnsubscribePage from '@/pages/unsubscribe';
import { NotificationPreferencesPage } from '@/pages/notification-preferences';
import AuditLogPage from '@/pages/audit-log';
import type { PendingInvitation } from '@workspace/api-client-react';
// Dev-only: lazy-import so the fixture page is tree-shaken from production builds.
const DevTestTreePage = import.meta.env.DEV
  ? React.lazy(() => import('@/pages/dev-test-tree'))
  : null;
import { useOrgContext } from '@/hooks/use-org-context';
import type { OrgFeatureKey } from '@/hooks/use-org-context';
import { UpgradeBanner } from '@/components/ui/upgrade-modal';


function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t('auth.authenticating')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <SseProvider>{children}</SseProvider>;
}

/**
 * GatedRoute — wraps a page component with a feature flag check.
 *
 * - disabled:     redirects to "/" (hard-off; instance admin removed the feature)
 * - unsubscribed: renders <UpgradeBanner> in place of the page
 * - enabled:      renders the page normally
 *
 * Route params (e.g. `params.id` from `/webhooks/inbound/:id`) are forwarded
 * to the wrapped component so deep-link routes continue to work.
 */
function GatedRoute({
  feature,
  component: Component,
  ...routeProps
}: {
  feature: OrgFeatureKey;
  component: React.ComponentType<any>;
  [key: string]: any;
}) {
  const { isFeatureEnabled, isFeatureUnsubscribed } = useOrgContext();
  const [, setLocation] = useLocation();
  const hardOff = !isFeatureEnabled(feature) && !isFeatureUnsubscribed(feature);

  useEffect(() => {
    if (hardOff) setLocation('/');
  }, [hardOff, setLocation]);

  if (hardOff) return null;

  if (isFeatureUnsubscribed(feature)) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <UpgradeBanner feature={feature} />
      </div>
    );
  }

  return <Component {...routeProps} />;
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/new" component={ProjectNewPage} />
        <Route path="/projects/:id/edit" component={ProjectEditPage} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/tasks" component={TasksList} />
        <Route path="/tasks/new" component={TaskNewPage} />
        <Route path="/tasks/:id/edit" component={TaskEditPage} />
        <Route path="/tasks/:id" component={TaskDetail} />
        <Route path="/notes" component={NotesPage} />
        <Route path="/org/settings" component={OrgSettings} />
        <Route path="/webhooks" component={(p: any) => <GatedRoute feature="webhooks" component={WebhooksPage} {...p} />} />
        <Route path="/webhooks/inbound/:id" component={(p: any) => <GatedRoute feature="webhooks" component={WebhookInboundEditPage} {...p} />} />
        <Route path="/webhooks/outbound/:id" component={(p: any) => <GatedRoute feature="webhooks" component={WebhookOutboundEditPage} {...p} />} />
        <Route path="/settings/notifications" component={NotificationPreferencesPage} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function OrgAwareApp() {
  return (
    <OrgGuard
      onboarding={(onCreated) => (
        <OrgOnboarding onCreated={onCreated} />
      )}
      invitation={(inv: PendingInvitation) => (
        <OrgInvitation
          invitation={inv}
          onAccepted={() => queryClient.invalidateQueries({ queryKey: ['getMyOrg'] })}
          onDeclined={() => queryClient.invalidateQueries({ queryKey: ['getMyOrg'] })}
        />
      )}
    >
      <BrandingProvider>
        <TerminologyProvider>
          <Router />
          <GlobalSearchPalette />
        </TerminologyProvider>
      </BrandingProvider>
    </OrgGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <GlobalSearchProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Switch>
                {/* Invite acceptance - outside AuthGuard/OrgGuard so unauthenticated
                    users can see the invite details before being asked to log in */}
                <Route path="/invite/:token" component={InvitePage} />
                {/* One-click unsubscribe - no login required; token is proof of identity */}
                <Route path="/unsubscribe" component={UnsubscribePage} />
                {/* Instance admin console - has its own auth check via /api/admin/me */}
                <Route path="/admin" component={AdminConsolePage} />
                <Route path="/admin/:rest*" component={AdminConsolePage} />
                {/* Dev-only: touch-drag fixture for e2e tests (no auth required) */}
                {DevTestTreePage && (
                  <Route path="/dev-test/tree">
                    <Suspense fallback={null}>
                      <DevTestTreePage />
                    </Suspense>
                  </Route>
                )}
                <Route>
                  <AuthGuard>
                    <OrgAwareApp />
                  </AuthGuard>
                </Route>
              </Switch>
            </WouterRouter>
            <Toaster />
          </GlobalSearchProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
