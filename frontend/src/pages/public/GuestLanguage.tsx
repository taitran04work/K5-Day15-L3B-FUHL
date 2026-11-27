import { useLayoutEffect, useMemo, type ReactNode } from "react"
import { I18nextProvider } from "react-i18next"
import i18n, { createGuestI18n } from "@/i18n"
import { getLanguageOption } from "@/i18n/languages"

export function GuestLanguage({ language, children }: { language?: string; children: ReactNode }) {
  const code = language == null ? null : getLanguageOption(language).value
  const guestI18n = useMemo(() => code ? createGuestI18n(code) : i18n, [code])

  useLayoutEffect(() => {
    if (!code) return
    const documentRoot = document.documentElement
    documentRoot.lang = code
    return () => {
      documentRoot.lang = getLanguageOption(i18n.language).value
    }
  }, [code])

  return <I18nextProvider i18n={guestI18n}>{children}</I18nextProvider>
}
