/**
 * Notification Preferences page — /settings/notifications
 *
 * Lets each user toggle which event types generate in-app notifications
 * and configure the email digest frequency.
 */

import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell, Mail } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type NotificationType =
  | "task_assigned"
  | "task_updated"
  | "comment_added"
  | "sla_breached"
  | "mention"
  | "comment_reply";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface NotificationPreference {
  eventType: NotificationType;
  enabled: boolean;
}

function getTypeMeta(t: (k: string) => string): Record<NotificationType, { label: string; description: string }> {
  return {
    task_assigned: {
      label: t('notificationPreferences.types.taskAssigned'),
      description: t('notificationPreferences.types.taskAssignedDesc'),
    },
    task_updated: {
      label: t('notificationPreferences.types.taskUpdated'),
      description: t('notificationPreferences.types.taskUpdatedDesc'),
    },
    comment_added: {
      label: t('notificationPreferences.types.commentAdded'),
      description: t('notificationPreferences.types.commentAddedDesc'),
    },
    sla_breached: {
      label: t('notificationPreferences.types.slaBreached'),
      description: t('notificationPreferences.types.slaBreachedDesc'),
    },
    mention: {
      label: t('notificationPreferences.types.mention'),
      description: t('notificationPreferences.types.mentionDesc'),
    },
    comment_reply: {
      label: t('notificationPreferences.types.commentReply'),
      description: t('notificationPreferences.types.commentReplyDesc'),
    },
  };
}

const ORDER: NotificationType[] = [
  "task_assigned",
  "task_updated",
  "comment_added",
  "comment_reply",
  "sla_breached",
  "mention",
];

async function fetchPreferences(): Promise<NotificationPreference[]> {
  const res = await fetch(`${BASE}/api/notification-preferences`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load preferences");
  return res.json() as Promise<NotificationPreference[]>;
}

async function savePreferences(
  prefs: NotificationPreference[],
): Promise<NotificationPreference[]> {
  const res = await fetch(`${BASE}/api/notification-preferences`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Failed to save preferences");
  return res.json() as Promise<NotificationPreference[]>;
}

type DigestFrequency = "none" | "daily" | "weekly";

async function fetchDigestPreference(): Promise<DigestFrequency> {
  const res = await fetch(`${BASE}/api/email-digest-preference`, {
    credentials: "include",
  });
  if (!res.ok) return "none";
  const data = await res.json() as { frequency: DigestFrequency };
  return data.frequency;
}

async function saveDigestPreference(frequency: DigestFrequency): Promise<void> {
  await fetch(`${BASE}/api/email-digest-preference`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frequency }),
  });
}

export function NotificationPreferencesPage() {
  const { t } = useTranslation();
  const typeMeta = getTypeMeta(t);
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [digestFrequency, setDigestFrequency] = useState<DigestFrequency>("none");
  const [savingDigest, setSavingDigest] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchPreferences(),
      fetchDigestPreference(),
    ])
      .then(([loadedPrefs, freq]) => {
        setPrefs(loadedPrefs);
        setDigestFrequency(freq);
      })
      .catch(() =>
        toast({
          title: t('common.error'),
          description: t('notificationPreferences.errorLoad'),
          variant: "destructive",
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const handleDigestChange = async (freq: DigestFrequency) => {
    setSavingDigest(true);
    try {
      await saveDigestPreference(freq);
      setDigestFrequency(freq);
      toast({ title: t('notificationPreferences.saved') });
    } catch {
      toast({ title: t('common.error'), description: t('notificationPreferences.errorDigest'), variant: "destructive" });
    } finally {
      setSavingDigest(false);
    }
  };

  const toggle = async (type: NotificationType) => {
    const updated = prefs.map((p) =>
      p.eventType === type ? { ...p, enabled: !p.enabled } : p,
    );
    setPrefs(updated);
    setSaving(true);
    try {
      const saved = await savePreferences(updated);
      setPrefs(saved);
      toast({ title: t('notificationPreferences.saved') });
    } catch {
      // Revert on failure
      setPrefs(prefs);
      toast({
        title: t('common.error'),
        description: t('notificationPreferences.errorSave'),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const orderedPrefs = ORDER.map(
    (type) =>
      prefs.find((p) => p.eventType === type) ?? {
        eventType: type,
        enabled: true,
      },
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Link href="/org/settings">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            {t('common.back')}
          </Button>
        </Link>
      </div>

      {/* Email digest card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-muted-foreground" />
            <CardTitle>{t('notificationPreferences.emailNotifications')}</CardTitle>
          </div>
          <CardDescription>
            {t('notificationPreferences.digestFrequency')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-9 w-40 bg-muted animate-pulse rounded" />
          ) : (
            <div className="flex items-center gap-3">
              <Label className="text-sm shrink-0">{t('notificationPreferences.digestFrequency')}</Label>
              <Select
                value={digestFrequency}
                onValueChange={(v) => void handleDigestChange(v as DigestFrequency)}
                disabled={savingDigest}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('notificationPreferences.never')}</SelectItem>
                  <SelectItem value="daily">{t('notificationPreferences.daily')}</SelectItem>
                  <SelectItem value="weekly">{t('notificationPreferences.weekly')}</SelectItem>
                </SelectContent>
              </Select>
              {savingDigest && <span className="text-xs text-muted-foreground">{t('common.saving')}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <CardTitle>{t('notificationPreferences.title')}</CardTitle>
          </div>
          <CardDescription>
            {t('notificationPreferences.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          {loading ? (
            <div className="space-y-4 py-2">
              {ORDER.map((type) => (
                <div
                  key={type}
                  className="flex items-center justify-between py-3 border-b border-border last:border-0"
                >
                  <div className="space-y-1">
                    <div className="h-4 w-40 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-64 bg-muted animate-pulse rounded" />
                  </div>
                  <div className="h-5 w-9 bg-muted animate-pulse rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div>
              {orderedPrefs.map((pref) => {
                const meta = typeMeta[pref.eventType];
                return (
                  <div
                    key={pref.eventType}
                    className="flex items-center justify-between py-3.5 border-b border-border last:border-0"
                  >
                    <div className="flex-1 min-w-0 pr-6">
                      <Label
                        htmlFor={`pref-${pref.eventType}`}
                        className="font-medium text-sm cursor-pointer"
                      >
                        {meta.label}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {meta.description}
                      </p>
                    </div>
                    <Switch
                      id={`pref-${pref.eventType}`}
                      checked={pref.enabled}
                      disabled={saving}
                      onCheckedChange={() => toggle(pref.eventType)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
