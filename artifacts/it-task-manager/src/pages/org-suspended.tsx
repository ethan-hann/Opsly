import { AlertTriangle } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";

export function OrgSuspendedPage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-md px-6">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">Organization Suspended</h1>
        <p className="text-muted-foreground">
          Your organization has been suspended by the instance administrator. Please contact your
          server operator to restore access.
        </p>
        <Button variant="outline" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
