import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';

import { ThemeProvider } from '@/components/theme-provider';
import { AppLayout } from '@/components/layout/app-layout';
import { OrgGuard } from '@/hooks/use-org-context';

import Dashboard from '@/pages/dashboard';
import ProjectsList from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import TasksList from '@/pages/tasks';
import TaskDetail from '@/pages/task-detail';
import NotesPage from '@/pages/notes';
import LoginPage from '@/pages/login';
import OrgOnboarding from '@/pages/org-onboarding';
import OrgInvitation from '@/pages/org-invitation';
import OrgSettings from '@/pages/org-settings';
import type { PendingInvitation } from '@workspace/api-client-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground font-mono">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/tasks" component={TasksList} />
        <Route path="/tasks/:id" component={TaskDetail} />
        <Route path="/notes" component={NotesPage} />
        <Route path="/org/settings" component={OrgSettings} />
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
      <Router />
    </OrgGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthGuard>
              <OrgAwareApp />
            </AuthGuard>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
