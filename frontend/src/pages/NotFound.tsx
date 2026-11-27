import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <div className="auth-page flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl">{t("notFound.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("notFound.description")}</p>
      <Button asChild className="mt-6">
        <Link to="/">{t("notFound.home")}</Link>
      </Button>
    </div>
  )
}
