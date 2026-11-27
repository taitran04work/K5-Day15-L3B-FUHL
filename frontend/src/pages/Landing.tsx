import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { useBrand } from "@/lib/brand"

export default function Landing() {
  const { t } = useTranslation()
  useBrand("#1F5F4A")
  const features = [
    { title: t("landing.f1Title"), body: t("landing.f1Body") },
    { title: t("landing.f2Title"), body: t("landing.f2Body") },
    { title: t("landing.f3Title"), body: t("landing.f3Body") },
  ]
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs text-background">S</span>
          Stayra
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitch />
          <Button asChild variant="outline" size="sm">
            <Link to="/login">{t("auth.signIn")}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6">
        <section className="max-w-3xl pb-20 pt-16 sm:pt-28">
          <h1 className="text-xl leading-tight sm:text-2xl">{t("landing.title")}</h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">{t("landing.subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/h/pine-hill">
                {t("landing.demoPine")} <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/h/sea-breeze">{t("landing.demoSea")}</Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-10 border-t py-16 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title}>
              <h2 className="text-base">{f.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="mx-auto max-w-6xl border-t px-6 py-8 text-xs text-muted-foreground">© {new Date().getFullYear()} Stayra</footer>
    </div>
  )
}
