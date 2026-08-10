"use client";

import { GlobeIcon } from "lucide-react";

import { locales, useI18n, useT } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

// Compact language switcher for the header/sidebar: globe icon + locale
// code, expanding to the full locale names.
export function LanguageSelect() {
  const t = useT();
  const { locale, setLocale } = useI18n();

  const names: Record<(typeof locales)[number], string> = {
    en: t("langEnglish"),
  };

  return (
    <Select value={locale} onValueChange={(v) => v && setLocale(v as (typeof locales)[number])}>
      <SelectTrigger
        className="h-8 gap-1 px-2"
        aria-label={t("langLabel")}
      >
        <GlobeIcon className="size-4" />
        <span className="text-xs font-medium uppercase">{locale}</span>
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {names[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
