import { Link, Navigate, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Spinner, useErrorMessage } from "@/components/common"
import { useAuth } from "@/lib/auth"
import { AuthLayout } from "./AuthLayout"

export default function Login() {
  const { t } = useTranslation()
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const errorMessage = useErrorMessage()
  const schema = z.object({ email: z.string().email(t("validation.email")), password: z.string().min(1, t("validation.required")) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => login(v.email, v.password),
    onSuccess: (u) => navigate(params.get("next") ?? (u.role === "PlatformAdmin" ? "/admin" : "/app"), { replace: true }),
  })

  if (user) return <Navigate to={user.role === "PlatformAdmin" ? "/admin" : "/app"} replace />

  return (
    <AuthLayout title={t("auth.signInTitle")} description={t("auth.signInDescription")}>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
        <Field label={t("auth.email")} htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <Field label={t("auth.password")} htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        {mutation.error && (
          <p className="rounded-md bg-muted px-3 py-2.5 text-sm" role="alert">
            {errorMessage(mutation.error)}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />} {t("auth.signIn")}
        </Button>
        <div className="text-center">
          <Link to="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t("auth.forgot")}
          </Link>
        </div>
      </form>
    </AuthLayout>
  )
}
