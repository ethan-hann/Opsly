import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'zh', nativeName: '中文' },
  { code: 'ar', nativeName: 'العربية' },
] as const;

export function LanguagePicker() {
  const { t } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] ?? 'en';

  const handleChange = (code: string) => {
    void i18n.changeLanguage(code);
  };

  const currentLabel =
    LANGUAGES.find((l) => l.code === currentLang)?.nativeName ?? 'English';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs px-2"
          aria-label={t('nav.language')}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {LANGUAGES.map(({ code, nativeName }) => (
          <DropdownMenuItem
            key={code}
            onClick={() => handleChange(code)}
            className={currentLang === code ? 'font-semibold text-primary' : ''}
          >
            {nativeName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
