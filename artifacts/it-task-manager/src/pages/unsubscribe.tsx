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
import { useTranslation } from 'react-i18next';

type Status = 'loading' | 'success' | 'error';

function getToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? '';
}

export default function UnsubscribePage() {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setErrorMsg(t('unsubscribe.noToken'));
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
          setErrorMsg(data.error ?? t('unsubscribe.genericError'));
          setStatus('error');
        }
      })
      .catch(() => {
        setErrorMsg(t('unsubscribe.networkError'));
        setStatus('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {t('unsubscribe.processingTitle')}
              </h1>
              <p className="text-sm text-gray-500">
                {t('unsubscribe.processingDesc')}
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {t('unsubscribe.successTitle')}
              </h1>
              <p className="text-sm text-gray-500">
                {t('unsubscribe.successDesc')}{' '}
                <a
                  href="/settings/notifications"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  {t('unsubscribe.notificationSettings')}
                </a>
                .
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-red-500" />
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {t('unsubscribe.errorTitle')}
              </h1>
              <p className="text-sm text-gray-500">{errorMsg}</p>
              <p className="text-sm text-gray-400">
                {t('unsubscribe.managePrefs')}{' '}
                <a
                  href="/settings/notifications"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  {t('unsubscribe.notificationSettings')}
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
