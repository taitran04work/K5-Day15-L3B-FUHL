import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ApiError } from "@/lib/api"
import type { BookingStatus, PaymentStatus } from "@/lib/types"
import { AnimatedValue } from "@/components/motion/CountUp"

export function PageHeader({ title, description, actions, className }: { title: string; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-base font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error?: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation()
  const message = error instanceof ApiError && error.status !== 500 && error.message ? error.message : t("common.errorDescription")
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border px-6 py-14 text-center", className)} role="alert">
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertCircle className="size-5" />
      </div>
      <p className="text-base font-medium">{t("common.errorTitle")}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          {t("common.tryAgain")}
        </Button>
      )}
    </div>
  )
}

export function RowsSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y rounded-xl border", className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} aria-hidden />
}

const pendingStatus = "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-warning/10 dark:text-warning dark:ring-warning/25"
const failedStatus = "bg-red-50 text-red-800 ring-red-200 dark:bg-destructive/10 dark:text-destructive dark:ring-destructive/25"
const positiveStatus = "bg-status-positive-soft text-status-positive ring-status-positive/20"

const statusTone: Record<string, string> = {
  Hold: pendingStatus,
  PendingDeposit: pendingStatus,
  Confirmed: positiveStatus,
  CheckedIn: "bg-foreground/[0.06] text-foreground ring-foreground/15",
  CheckedOut: "bg-muted text-muted-foreground ring-border",
  Cancelled: "bg-muted text-muted-foreground ring-border",
  Expired: "bg-muted text-muted-foreground ring-border",
  NoShow: failedStatus,
  Created: pendingStatus,
  Paid: positiveStatus,
  Failed: failedStatus,
  Refunded: "bg-muted text-muted-foreground ring-border",
  Pending: pendingStatus,
  Approved: positiveStatus,
  Auto: positiveStatus,
  Rejected: "bg-muted text-muted-foreground ring-border",
}

export function StatusBadge({ status, kind = "booking", className }: { status: BookingStatus | PaymentStatus | string; kind?: "booking" | "payment" | "request"; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", statusTone[status] ?? "bg-muted text-muted-foreground ring-border", className)}>
      {t(`status.${kind}.${status}`)}
    </span>
  )
}

export function Field({ label, htmlFor, error, hint, children, className, optional }: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode; className?: string; optional?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function Section({ title, description, children, actions, className }: { title?: string; description?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card px-5 py-4", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular tracking-tight"><AnimatedValue value={value} /></p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Maps an ApiError field error code to a localized message. */
export function useFieldError() {
  const { t } = useTranslation()
  return (error: unknown, field: string): string | undefined => {
    if (!(error instanceof ApiError)) return undefined
    const code = error.errors[field]?.[0]
    return code ? t(`validation.${code}`, { defaultValue: t("validation.invalid") }) : undefined
  }
}

/** Localized message for an API error (server title as fallback). */
export function useErrorMessage() {
  const { t } = useTranslation()
  return (error: unknown) => {
    if (error instanceof ApiError) return t(`errors.${error.code}`, { defaultValue: error.message || t("common.errorDescription") })
    return t("common.errorDescription")
  }
}
