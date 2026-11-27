import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Spinner, useErrorMessage } from "@/components/common"
import { api } from "@/lib/api"
import { AuthLayout } from "./AuthLayout"

export default function ResetPassword() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const invite = params.get("invite") === "1"
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const errorMessage = useErrorMessage()
  const mutation = useMutation({ mutationFn: () => api.post("/api/auth/reset", { token, password }) })
  const mismatch = confirm.length > 0 && password !== confirm

  if (mutation.isSuccess)
    return (
      <AuthLayout title={t("auth.passwordSetTitle")} description={t("auth.passwordSetDescription")}>
        <Button asChild className="w-full">
          <Link to="/login">{t("auth.signIn")}</Link>
        </Button>
      </AuthLayout>
    )

  return (
    <AuthLayout title={invite ? t("auth.inviteTitle") : t("auth.resetTitle")} description={invite ? t("auth.inviteDescription") : t("auth.resetDescription")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length >= 8 && !mismatch) mutation.mutate()
        }}
      >
        <Field label={t("auth.newPassword")} htmlFor="password" hint={t("auth.passwordHint")}>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t("auth.confirmPassword")} htmlFor="confirm" error={mismatch ? t("validation.passwords_differ") : undefined}>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {mutation.error && <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{errorMessage(mutation.error)}</p>}
        <Button type="submit" className="w-full" disabled={mutation.isPending || password.length < 8 || mismatch || !token}>
          {mutation.isPending && <Spinner />} {t("auth.savePassword")}
        </Button>
      </form>
    </AuthLayout>
  )
}
