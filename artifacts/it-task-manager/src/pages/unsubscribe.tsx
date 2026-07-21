/**
 * One-click unsubscribe confirmation page.
 *
 * Rendered when a user clicks the unsubscribe link in a digest email.
 * Calls GET /api/unsubscribe?token=<jwt> (no login required) and shows
 * the result. The token is taken from the page's own query string.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

type Status = 'loading' | 'success' | 'error';

function getToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? '';
}

export default function UnsubscribePage() {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setErrorMsg('No unsubscribe token found. Please use the link from your digest email.');
      setStatus('error');
      return;
    }

    const base = import.meta.env.BASE_URL.replace(/\/$/, '');

    fetch(`${base}/api/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setStatus('success');
        } else {
          setErrorMsg(data.error ?? 'Something went wrong. Please try again.');
          setStatus('error');
        }
      })
      .catch(() => {
        setErrorMsg('Could not reach the server. Please try again later.');
        setStatus('error');
      });
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Processing…
              </h1>
              <p className="text-sm text-gray-500">
                Updating your email preferences.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                You've been unsubscribed
              </h1>
              <p className="text-sm text-gray-500">
                You will no longer receive digest emails. You can re-enable them
                at any time from{' '}
                <a
                  href="/settings/notifications"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  notification settings
                </a>
                .
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-red-500" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Unable to unsubscribe
              </h1>
              <p className="text-sm text-gray-500">{errorMsg}</p>
              <p className="text-sm text-gray-400">
                You can manage your digest preferences from{' '}
                <a
                  href="/settings/notifications"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  notification settings
                </a>
                .
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
