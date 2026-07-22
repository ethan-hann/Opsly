import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { useCreateOrg } from "@workspace/api-client-react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface OrgOnboardingProps {
  onCreated: () => void;
}

export default function OrgOnboarding({ onCreated }: OrgOnboardingProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const { toast } = useToast();
  const { mutate: createOrg, isPending } = useCreateOrg({
    mutation: {
      onSuccess: () => {
        toast({ title: t('orgOnboarding.created'), description: t('orgOnboarding.createdDesc') });
        onCreated();
      },
      onError: (err: Error) => {
        toast({
          title: t('orgOnboarding.createFailed'),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createOrg({ data: { name: name.trim() } });
  }

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
            <p className="text-muted-foreground text-sm mt-1">{t('orgOnboarding.tagline')}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('orgOnboarding.createOrg')}</CardTitle>
            <CardDescription>
              {t('orgOnboarding.createOrgDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">{t('orgOnboarding.orgName')}</Label>
                <Input
                  id="org-name"
                  placeholder={t('orgOnboarding.orgNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  maxLength={200}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isPending || !name.trim()}
              >
                {isPending ? t('orgOnboarding.creating') : t('orgOnboarding.createButton')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
