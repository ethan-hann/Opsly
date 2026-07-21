/**
 * SMTP tab — shows SMTP configuration status, lets instance admins edit the
 * config live (no restart required), and send a test email to verify delivery.
 *
 * Config source:
 *   "env" — values come from server environment variables (read-only here).
 *   "db"  — a DB override is active; can be edited or reset to env vars.
 *
 * The SMTP password is write-only: the API never returns it. A `hasPassword`
 * boolean indicates whether one is saved.
 *
 * A server restart clears the DB override and reverts to env vars — this is
 * prominently noted when an override is active.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Mail, CheckCircle2, XCircle, Pencil, RotateCcw, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface SmtpStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  source: "env" | "db";
  hasPassword: boolean;
}

interface EditForm {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function AdminSmtpTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SmtpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [form, setForm] = useState<EditForm>({
    host: "",
    port: "587",
    secure: false,
    user: "",
    pass: "",
    from: "",
  });

  async function fetchStatus() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/email/status`, { credentials: "include" });
      const data: SmtpStatus | null = r.ok ? await r.json() : null;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchStatus();
  }, []);

  function startEdit() {
    if (!status) return;
    setForm({
      host: status.host,
      port: String(status.port),
      secure: status.secure,
      user: status.user,
      pass: "", // always blank — write-only
      from: status.from,
    });
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    const portNum = parseInt(form.port, 10);
    if (!form.host.trim()) {
      toast({ title: "Validation error", description: "Host is required.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      toast({ title: "Validation error", description: "Port must be a number between 1 and 65535.", variant: "destructive" });
      return;
    }
    if (!form.from.trim()) {
      toast({ title: "Validation error", description: "From address is required.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        host: form.host.trim(),
        port: portNum,
        secure: form.secure,
        user: form.user.trim(),
        from: form.from.trim(),
      };
      // Only send pass if the admin actually typed something
      if (form.pass) body.pass = form.pass;

      const res = await fetch(`${BASE}/api/admin/email/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: "Save failed", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      const updated = await res.json() as SmtpStatus;
      setStatus(updated);
      setIsEditing(false);
      toast({ title: "SMTP config saved", description: "The new settings are active immediately." });
    } catch (err) {
      toast({ title: "Request failed", description: String(err), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function resetToEnv() {
    if (!confirm("Reset SMTP config to environment variables? The DB override will be deleted.")) return;
    setIsResetting(true);
    try {
      const res = await fetch(`${BASE}/api/admin/email/config`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: "Reset failed", description: err.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      const updated = await res.json() as SmtpStatus;
      setStatus(updated);
      setIsEditing(false);
      toast({ title: "Reset to environment variables", description: "The DB override has been removed." });
    } catch (err) {
      toast({ title: "Request failed", description: String(err), variant: "destructive" });
    } finally {
      setIsResetting(false);
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmail.trim()) return;
    setIsSending(true);
    try {
      const res = await fetch(`${BASE}/api/admin/email/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail.trim() }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (body.success) {
        toast({ title: "Test email sent", description: `Delivered to ${testEmail.trim()}` });
      } else {
        toast({ title: "Delivery failed", description: body.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Request failed", description: String(err), variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDbOverride = status?.source === "db";

  return (
    <div className="space-y-6 max-w-2xl">
      {/* DB override warning banner */}
      {isDbOverride && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-800 dark:text-amber-300">
            <strong>DB override active.</strong> These values override the server environment variables.
            A server restart will revert to the values from environment variables.
          </p>
        </div>
      )}

      {/* Status / Edit card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="w-4 h-4" />
              SMTP Configuration
            </CardTitle>
            <div className="flex items-center gap-2">
              {status && !isEditing && (
                <>
                  <Badge variant={isDbOverride ? "default" : "secondary"} className="text-xs">
                    {isDbOverride ? "DB override" : "From environment"}
                  </Badge>
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={startEdit}>
                    <Pencil className="w-3 h-3" />
                    Edit
                  </Button>
                  {isDbOverride && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 h-8 text-muted-foreground hover:text-foreground"
                      onClick={resetToEnv}
                      disabled={isResetting}
                    >
                      {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Reset to environment
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {!isEditing && (
            <CardDescription>
              {isDbOverride
                ? "A database override is active. Edit or reset below."
                : "SMTP is configured via server environment variables."}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isEditing ? (
            /* ─── Edit form ─────────────────────────────────────── */
            <form onSubmit={saveConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-host" className="text-xs">Host <span className="text-destructive">*</span></Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={form.host}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                    disabled={isSaving}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-port" className="text-xs">Port <span className="text-destructive">*</span></Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    placeholder="587"
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                    disabled={isSaving}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="smtp-secure"
                  checked={form.secure}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, secure: v }))}
                  disabled={isSaving}
                />
                <Label htmlFor="smtp-secure" className="text-sm cursor-pointer">
                  Use TLS/SSL (port 465)
                </Label>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtp-user" className="text-xs">Username</Label>
                <Input
                  id="smtp-user"
                  placeholder="user@example.com"
                  value={form.user}
                  onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                  disabled={isSaving}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtp-pass" className="text-xs">Password</Label>
                <Input
                  id="smtp-pass"
                  type="password"
                  placeholder={status?.hasPassword ? "••••••••  (leave blank to keep existing)" : "No password saved"}
                  value={form.pass}
                  onChange={(e) => setForm((f) => ({ ...f, pass: e.target.value }))}
                  disabled={isSaving}
                  className="h-9"
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  {status?.hasPassword
                    ? "A password is saved. Leave blank to keep the existing one, or type a new one to replace it."
                    : "No password is currently saved."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtp-from" className="text-xs">From address <span className="text-destructive">*</span></Label>
                <Input
                  id="smtp-from"
                  placeholder='Opsly <noreply@example.com>'
                  value={form.from}
                  onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
                  disabled={isSaving}
                  className="h-9"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" disabled={isSaving} className="gap-1.5">
                  {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isSaving ? "Saving…" : "Save config"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={isSaving}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            /* ─── Read-only display ─────────────────────────────── */
            <>
              <div className="flex items-center gap-3">
                {status?.configured ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">Connected</p>
                      <p className="text-xs text-muted-foreground">SMTP is configured and ready to send email.</p>
                    </div>
                    <Badge variant="secondary" className="ml-auto">Active</Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-medium text-sm">Not configured</p>
                      <p className="text-xs text-muted-foreground">
                        Set <code className="bg-muted px-1 rounded text-xs">SMTP_HOST</code> or use
                        the Edit button to configure SMTP.
                      </p>
                    </div>
                    <Badge variant="outline" className="ml-auto text-muted-foreground">Disabled</Badge>
                  </>
                )}
              </div>

              {status?.configured && (
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {[
                      ["Host", `${status.host}:${status.port}`],
                      ["Security", status.secure ? "TLS/SSL" : "STARTTLS"],
                      ["Username", status.user || "(none)"],
                      ["Password", status.hasPassword ? "••••••••" : "(not set)"],
                      ["From address", status.from],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 text-muted-foreground w-32">{label}</td>
                        <td className="py-2 font-mono text-xs">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* Environment variable reference */}
          {!isEditing && (
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1 select-none">
                <span className="group-open:hidden">▶</span>
                <span className="hidden group-open:inline">▼</span>
                Environment variable reference
              </summary>
              <table className="mt-2 w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left pb-1 text-muted-foreground font-medium">Variable</th>
                    <th className="text-left pb-1 text-muted-foreground font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {[
                    ["SMTP_HOST", "Mail server hostname (required)"],
                    ["SMTP_PORT", "Port — default 587"],
                    ["SMTP_SECURE", '"true" for TLS/SSL (port 465)'],
                    ["SMTP_USER", "SMTP auth username"],
                    ["SMTP_PASS", "SMTP auth password"],
                    ["SMTP_FROM", 'Sender address, e.g. "Opsly <noreply@example.com>"'],
                    ["APP_URL", "Frontend base URL used in email links"],
                    ["SECRET_ENCRYPTION_KEY", "Required to encrypt stored SMTP passwords"],
                  ].map(([name, desc]) => (
                    <tr key={name} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-4 text-foreground">{name}</td>
                      <td className="py-1.5 text-muted-foreground font-sans">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Test email card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send Test Email</CardTitle>
          <CardDescription>
            Send a test email to verify your SMTP configuration is working correctly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!status?.configured ? (
            <p className="text-sm text-muted-foreground">
              Configure SMTP first using the Edit button above, or set the environment variables.
            </p>
          ) : (
            <form onSubmit={sendTest} className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="test-email" className="text-xs">Recipient</Label>
                <Input
                  id="test-email"
                  type="email"
                  placeholder="you@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  disabled={isSending}
                  className="h-9"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isSending || !testEmail.trim()} className="gap-2 h-9">
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {isSending ? "Sending…" : "Send test"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
