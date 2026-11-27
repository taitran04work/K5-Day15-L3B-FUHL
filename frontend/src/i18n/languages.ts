const languages = {
  en: { value: "en", short: "EN", name: "English" },
  vi: { value: "vi", short: "VN", name: "Tiếng Việt" },
} as const

export type LanguageCode = keyof typeof languages

export const languageOptions = Object.values(languages)

export function getLanguageOption(language?: string | null) {
  return language?.startsWith("vi") ? languages.vi : languages.en
}
