import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"
import en from "./en"
import vi from "./vi"

type Tree = { [k: string]: string | Tree }

/** Vietnamese has a single plural form: expose each counted key as `key_other` too. */
function withPlurals(tree: Tree, reference: Tree): Tree {
  const out: Tree = { ...tree }
  for (const [k, v] of Object.entries(reference)) {
    if (typeof v === "object") out[k] = withPlurals((tree[k] as Tree) ?? {}, v)
    else if (k.endsWith("_other")) {
      const base = k.slice(0, -6)
      if (typeof tree[base] === "string") out[k] = tree[base]
    }
  }
  return out
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, vi: { translation: withPlurals(vi as Tree, en as Tree) } },
    fallbackLng: "en",
    supportedLngs: ["en", "vi"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: "stayra.lang", caches: ["localStorage"] },
    returnNull: false,
  })

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng.startsWith("vi") ? "vi" : "en"
})
document.documentElement.lang = i18n.language?.startsWith("vi") ? "vi" : "en"

export default i18n
