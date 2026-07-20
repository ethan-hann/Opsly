/**
 * SMTP tab — shows SMTP configuration status and lets instance admins
 * send a test email to verify delivery.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface SmtpStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
}

export function AdminSmtpTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<SmtpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/admin/email/status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SmtpStatus | null) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" />
            SMTP Configuration
          </CardTitle>
          <CardDescription>
            Email is configured via environment variables on the server. Changes require a server restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                    Set <code className="bg-muted px-1 rounded text-xs">SMTP_HOST</code> to enable email features.
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

          {/* Environment variable reference */}
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
                  ["SMTP_FROM", 'Sender address, e.g. "IT Tasks <noreply@example.com>"'],
                  ["APP_URL", "Frontend base URL used in email links"],
                ].map(([name, desc]) => (
                  <tr key={name} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 text-foreground">{name}</td>
                    <td className="py-1.5 text-muted-foreground font-sans">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
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
              Configure SMTP first by setting the environment variables above.
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
