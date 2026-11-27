import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

export function LanguageSwitch({ className, onChange, compact = false }: { className?: string; onChange?: (lng: "en" | "vi") => void; compact?: boolean }) {
  const { i18n, t } = useTranslation()
  const current = i18n.language?.startsWith("vi") ? "vi" : "en"
  return (
    <div role="radiogroup" aria-label={t("nav.language")} className={cn("inline-flex rounded-md border p-0.5 text-xs", className)}>
      {(["en", "vi"] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          role="radio"
          aria-checked={current === lng}
          aria-label={lng === "en" ? "English" : "Tiếng Việt"}
          onClick={() => {
            void i18n.changeLanguage(lng)
            onChange?.(lng)
          }}
          className={cn(
            "flex-1 whitespace-nowrap rounded-[5px] px-2.5 py-1 font-medium text-muted-foreground transition-colors",
            current === lng && "bg-foreground text-background",
          )}
        >
          {compact ? lng.toUpperCase() : lng === "en" ? "English" : "Tiếng Việt"}
        </button>
      ))}
    </div>
  )
}
