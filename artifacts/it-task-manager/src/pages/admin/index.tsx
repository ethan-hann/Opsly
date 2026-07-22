import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Building2, SlidersHorizontal, Users, BarChart3, ScrollText, Mail } from "lucide-react";
import { AdminOrgsTab } from "./orgs-tab";
import { AdminFeaturesTab } from "./features-tab";
import { AdminUsersTab } from "./users-tab";
import { AdminUsageTab } from "./usage-tab";
import { AdminAuditTab } from "./audit-tab";
import { AdminSmtpTab } from "./smtp-tab";
import { useTranslation } from "react-i18next";
import { LanguagePicker } from "@/components/ui/language-picker";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

async function checkIsInstanceAdmin(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/admin/me`, { credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

export default function AdminConsolePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"loading" | "authorized" | "denied">("loading");

  useEffect(() => {
    checkIsInstanceAdmin().then((ok) => setStatus(ok ? "authorized" : "denied"));
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t('admin.checkingAccess')}</p>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">{t('admin.accessDenied')}</h1>
          <p className="text-muted-foreground max-w-sm">
            {t('admin.accessDeniedDesc')}
          </p>
          <a href="/" className="text-primary underline text-sm">
            {t('admin.returnToApp')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Admin header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-destructive flex items-center justify-center">
              <Shield className="w-4 h-4 text-destructive-foreground" />
            </div>
            <div>
              <h1 className="font-bold tracking-tight">{t('admin.title')}</h1>
              <p className="text-xs text-muted-foreground">{t('admin.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguagePicker />
            <a
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('admin.backToApp')}
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="orgs">
          <TabsList className="mb-6">
            <TabsTrigger value="orgs" className="gap-2">
              <Building2 className="w-4 h-4" />
              {t('admin.tabs.orgs')}
            </TabsTrigger>
            <TabsTrigger value="features" className="gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              {t('admin.tabs.features')}
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              {t('admin.tabs.users')}
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              {t('admin.tabs.usage')}
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <ScrollText className="w-4 h-4" />
              {t('admin.tabs.auditLog')}
            </TabsTrigger>
            <TabsTrigger value="smtp" className="gap-2">
              <Mail className="w-4 h-4" />
              {t('admin.tabs.smtp')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orgs">
            <AdminOrgsTab />
          </TabsContent>
          <TabsContent value="features">
            <AdminFeaturesTab />
          </TabsContent>
          <TabsContent value="users">
            <AdminUsersTab />
          </TabsContent>
          <TabsContent value="usage">
            <AdminUsageTab />
          </TabsContent>
          <TabsContent value="audit">
            <AdminAuditTab />
          </TabsContent>
          <TabsContent value="smtp">
            <AdminSmtpTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
