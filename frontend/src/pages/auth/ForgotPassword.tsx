import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Spinner } from "@/components/common"
import { api } from "@/lib/api"
import { AuthLayout } from "./AuthLayout"

export default function ForgotPassword() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const mutation = useMutation({ mutationFn: () => api.post("/api/auth/forgot", { email }) })

  if (mutation.isSuccess)
    return (
      <AuthLayout title={t("auth.checkEmailTitle")} description={t("auth.checkEmailDescription", { email })} footer={<Link to="/login" className="underline underline-offset-4">{t("auth.backToSignIn")}</Link>}>
        <span />
      </AuthLayout>
    )

  return (
    <AuthLayout title={t("auth.forgotTitle")} description={t("auth.forgotDescription")} footer={<Link to="/login" className="underline underline-offset-4">{t("auth.backToSignIn")}</Link>}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (email.includes("@")) mutation.mutate()
        }}
      >
        <Field label={t("auth.email")} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={mutation.isPending || !email.includes("@")}>
          {mutation.isPending && <Spinner />} {t("auth.sendLink")}
        </Button>
      </form>
    </AuthLayout>
  )
}
