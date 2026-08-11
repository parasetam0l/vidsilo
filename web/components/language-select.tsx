"use client";

import { locales, useI18n, useT } from "@/lib/i18n";
import { Select } from "@/components/ui/select";

// Compact language switcher for the header/sidebar: locale code, expanding
// to the full locale names.
export function LanguageSelect() {
  const t = useT();
  const { locale, setLocale } = useI18n();

  const names: Record<(typeof locales)[number], string> = {
    en: t("langEnglish"),
  };

  return (
    <Select
      className="h-8 w-auto gap-1 px-2 text-xs"
      options={locales.map((l) => ({ value: l, label: names[l] }))}
      value={locale}
      onChange={(v) => setLocale(v as (typeof locales)[number])}
      placeholder={t("langLabel")}
    />
  );
}
