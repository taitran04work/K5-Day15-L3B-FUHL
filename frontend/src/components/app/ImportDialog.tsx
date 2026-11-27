import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, FileSpreadsheet } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Spinner, useErrorMessage } from "@/components/common"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ImportPreview } from "@/lib/types"

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const preview = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return api.upload<ImportPreview>("/api/app/rooms/import/preview", form)
    },
  })
  const commit = useMutation({
    mutationFn: () => api.post<{ created: number; updated: number }>("/api/app/rooms/import/commit", preview.data?.rows ?? []),
    onSuccess: (r) => {
      toast.success(t("import.done", { created: r.created, updated: r.updated }))
      void qc.invalidateQueries({ queryKey: ["rooms"] })
      close(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const close = (o: boolean) => {
    if (!o) {
      preview.reset()
      setFileName(null)
    }
    onOpenChange(o)
  }

  const data = preview.data
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("import.template")}</span>
              <Button variant="outline" size="sm" onClick={() => void api.download("/api/app/rooms/import/template?format=xlsx", "stayra-rooms-template.xlsx")}>
                <Download /> Excel (.xlsx)
              </Button>
              <Button variant="outline" size="sm" onClick={() => void api.download("/api/app/rooms/import/template?format=csv", "stayra-rooms-template.csv")}>
                <Download /> CSV
              </Button>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center hover:bg-muted/40"
            >
              <FileSpreadsheet className="size-6 text-muted-foreground" />
              <span className="mt-3 text-sm font-medium">{fileName ?? t("import.chooseFile")}</span>
              <span className="mt-1 text-xs text-muted-foreground">{t("import.fileHint")}</span>
              {preview.isPending && <Spinner className="mt-3" />}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setFileName(f.name)
                  preview.mutate(f)
                }
                e.target.value = ""
              }}
            />
            {preview.error && <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>{t("import.summaryNew", { count: data.new })}</span>
              <span>{t("import.summaryUpdates", { count: data.updates })}</span>
              {data.invalid > 0 && <span className="text-destructive">{t("import.summaryInvalid", { count: data.invalid })}</span>}
            </div>
            <div className="responsive-table-frame rounded-xl border">
              <table className="responsive-table w-full text-sm" role="table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("import.row")}</th>
                    <th className="px-3 py-2 font-medium">{t("rooms.name")}</th>
                    <th className="px-3 py-2 font-medium">{t("rooms.code")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("rooms.maxGuests")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("rooms.nightlyPrice")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("rooms.hourlyPrice")}</th>
                    <th className="px-3 py-2 font-medium">{t("import.result")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.map((r) => {
                    const bad = Object.keys(r.errors).length > 0
                    return (
                      <tr key={r.row} className={cn(bad && "bg-red-50/60")}>
                        <td data-label={t("import.row")} className="px-3 py-2 text-muted-foreground tabular">{r.row}</td>
                        <td data-row-title className="px-3 py-2">{r.name || "–"}</td>
                        <td data-label={t("rooms.code")} className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td data-label={t("rooms.maxGuests")} className="px-3 py-2 text-right tabular">{r.maxGuests || ""}</td>
                        <td data-label={t("rooms.nightlyPrice")} className="px-3 py-2 text-right tabular">{r.nightlyPrice ? money(r.nightlyPrice) : ""}</td>
                        <td data-label={t("rooms.hourlyPrice")} className="px-3 py-2 text-right tabular">{r.hourlyPrice ? money(r.hourlyPrice) : ""}</td>
                        <td data-label={t("import.result")} data-row-wide className="px-3 py-2 text-xs">
                          {bad ? (
                            <ul className="space-y-0.5 text-destructive">
                              {Object.entries(r.errors).map(([field, code]) => (
                                <li key={field}>
                                  {t(`import.field.${field}`, { defaultValue: field })}: {t(`validation.${code}`, { defaultValue: code })}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">{r.exists ? t("import.willUpdate") : t("import.willCreate")}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {data.invalid > 0 && <p className="text-xs text-muted-foreground">{t("import.invalidSkipped")}</p>}
          </div>
        )}

        <DialogFooter>
          {data && (
            <Button variant="ghost" className="mr-auto" onClick={() => { preview.reset(); setFileName(null) }}>
              {t("import.chooseAnother")}
            </Button>
          )}
          <Button variant="outline" onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          {data && (
            <Button onClick={() => commit.mutate()} disabled={commit.isPending || data.valid === 0}>
              {commit.isPending && <Spinner />} {t("import.commit", { count: data.valid })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
