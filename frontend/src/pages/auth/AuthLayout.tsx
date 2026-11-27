import type { ReactNode } from "react"
import { Link } from "react-router"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { ThemeSwitch } from "@/components/layout/SystemTheme"
import { Logo } from "@/components/Logo"

export function AuthLayout({ title, description, children, footer }: { title: string; description?: string; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page grid min-h-dvh grid-rows-[minmax(4.5rem,1fr)_auto_minmax(1.5rem,1fr)]">
      <header className="flex items-start justify-end gap-2 px-4 py-4 sm:px-8 sm:py-6">
        <LanguageSwitch className="h-9 bg-card" />
        <ThemeSwitch />
      </header>
      <main className="mx-auto w-full max-w-[30rem] px-4" aria-labelledby="auth-title">
        <div className="rounded-2xl border bg-card px-6 pb-7 pt-6 shadow-(--auth-shadow) sm:px-9 sm:pb-9 sm:pt-8">
          <Link to="/" className="mx-auto mb-3 block w-fit rounded-md" aria-label="Stayra">
            <Logo tone="auto" className="h-[4.75rem] sm:h-[5.75rem]" />
          </Link>
          <h1 id="auth-title" className="text-center text-xl font-bold">{title}</h1>
          {description && <p className="mt-2 text-center text-sm text-muted-foreground wrap-anywhere">{description}</p>}
          {children && <div className="mt-7 [&_button[type=submit]]:h-11 [&_input]:h-11">{children}</div>}
          {footer && <div className="mt-6 text-center text-sm text-muted-foreground [&_a:hover]:text-primary">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
