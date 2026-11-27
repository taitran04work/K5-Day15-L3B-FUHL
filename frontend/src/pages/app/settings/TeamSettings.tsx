import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, RowsSkeleton, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { api } from "@/lib/api"
import { initials, relative } from "@/lib/format"
import type { UserRole } from "@/lib/types"

interface Member {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  lastLoginAt: string | null
}

export default function TeamSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<Member[]>("/api/app/team") })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: "", name: "" })
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const invite = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string }>("/api/app/team", form),
    onSuccess: (r) => {
      setInviteUrl(r.inviteUrl)
      void qc.invalidateQueries({ queryKey: ["team"] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/app/team/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["team"] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Page narrow>
      <PageHeader
        title={t("team.title")}
        description={t("team.description")}
        actions={
          <Button onClick={() => { setForm({ email: "", name: "" }); setInviteUrl(null); invite.reset(); setOpen(true) }}>
            <UserPlus /> {t("team.invite")}
          </Button>
        }
      />
      {team.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : team.error ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {team.data!.map((m) => (
            <li key={m.id} className="flex items-center gap-4 px-4 py-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(m.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name} {!m.isActive && <span className="font-normal text-muted-foreground">· {t("team.removed")}</span>}
                </p>
                <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-sm">{t(`team.role.${m.role}`)}</p>
                <p className="text-xs text-muted-foreground">{m.lastLoginAt ? t("team.lastSeen", { when: relative(m.lastLoginAt) }) : t("team.neverSignedIn")}</p>
              </div>
              {m.role !== "Owner" && m.isActive && (
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.id)}>
                  {t("team.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("team.inviteTitle")}</DialogTitle>
            <DialogDescription>{t("team.inviteDescription")}</DialogDescription>
          </DialogHeader>
          {inviteUrl ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("team.inviteSent")}</p>
              <div className="flex gap-2">
                <Input readOnly value={inviteUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => { void navigator.clipboard.writeText(inviteUrl); toast.success(t("common.copied")) }} aria-label={t("common.copy")}>
                  <Copy />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label={t("team.name")}>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t("team.email")} error={fieldError(invite.error, "email")}>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            {inviteUrl ? (
              <Button onClick={() => setOpen(false)}>{t("common.done")}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={() => invite.mutate()} disabled={invite.isPending || !form.email.includes("@")}>
                  {invite.isPending && <Spinner />} {t("team.sendInvite")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
