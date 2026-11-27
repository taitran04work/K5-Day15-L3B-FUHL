import { useTranslation } from "react-i18next"
import { getLanguageOption, languageOptions } from "@/i18n/languages"
import { cn } from "@/lib/utils"

export function LanguageSwitch({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current = getLanguageOption(i18n.language).value
  return (
    <div role="radiogroup" aria-label={t("nav.language")} className={cn("inline-flex rounded-md border p-0.5 text-xs", className)}>
      {languageOptions.map(({ value, short, name }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={name}
          onClick={() => void i18n.changeLanguage(value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-[5px] px-2.5 py-1 font-medium text-muted-foreground transition-colors",
            current === value && "bg-foreground text-background",
          )}
        >
          {short}
        </button>
      ))}
    </div>
  )
}
