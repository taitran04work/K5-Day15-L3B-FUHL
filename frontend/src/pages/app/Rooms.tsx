import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { BedDouble, Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from "@/components/common"
import { PhotoTile } from "@/components/booking/BookingParts"
import { RoomEditor } from "@/components/app/RoomEditor"
import { ImportDialog } from "@/components/app/ImportDialog"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Room } from "@/lib/types"

export default function Rooms() {
  const { t } = useTranslation()
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => api.get<Room[]>("/api/app/rooms") })
  const [editing, setEditing] = useState<Room | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const open = (r: Room | null) => {
    setEditing(r)
    setEditorOpen(true)
  }

  return (
    <Page>
      <PageHeader
        title={t("rooms.title")}
        description={t("rooms.description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload /> {t("rooms.import")}
            </Button>
            <Button onClick={() => open(null)}>
              <Plus /> {t("rooms.add")}
            </Button>
          </>
        }
      />
      {rooms.isLoading ? (
        <RowsSkeleton />
      ) : rooms.error ? (
        <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
      ) : !rooms.data?.length ? (
        <EmptyState
          icon={<BedDouble />}
          title={t("rooms.emptyTitle")}
          description={t("rooms.emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload /> {t("rooms.import")}
              </Button>
              <Button onClick={() => open(null)}>
                <Plus /> {t("rooms.add")}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="responsive-table-frame rounded-xl border">
          <table className="responsive-table w-full text-sm" role="table">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("rooms.col.room")}</th>
                <th className="px-4 py-2.5 font-medium">{t("rooms.col.guests")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("rooms.col.night")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("rooms.col.hour")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("rooms.col.photos")}</th>
                <th className="px-4 py-2.5 font-medium">{t("rooms.col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rooms.data.map((r) => (
                <tr key={r.id} tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => e.key === "Enter" && open(r)} className="cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/60">
                  <td data-row-title className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <PhotoTile url={r.coverUrl} alt={r.name} className="h-10 w-14 shrink-0 rounded-md" />
                      <div className="min-w-0">
                        <p className="font-medium [overflow-wrap:anywhere]">{r.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.code}</p>
                      </div>
                    </div>
                  </td>
                  <td data-label={t("rooms.col.guests")} className="px-4 py-3 text-muted-foreground">{[r.beds, t("room.upToGuests", { count: r.maxGuests })].filter(Boolean).join(" · ")}</td>
                  <td data-label={t("rooms.col.night")} className="px-4 py-3 text-right tabular">{r.supportsNightly ? money(r.baseNightlyPrice) : <span className="text-muted-foreground">{t("rooms.notOffered")}</span>}</td>
                  <td data-label={t("rooms.col.hour")} className="px-4 py-3 text-right tabular">
                    {r.supportsHourly ? (
                      <>
                        {money(r.baseHourlyPrice)} <span className="text-xs text-muted-foreground">· {t("rooms.minH", { count: r.minHours })}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("rooms.notOffered")}</span>
                    )}
                  </td>
                  <td data-label={t("rooms.col.photos")} className={cn("px-4 py-3 text-right tabular", r.photos.length === 0 && "text-amber-700")}>{r.photos.length}</td>
                  <td data-label={t("rooms.col.status")} className="px-4 py-3">
                    <span className={cn("text-sm", r.isActive ? "text-foreground" : "text-muted-foreground")}>{r.isActive ? t("rooms.active") : t("rooms.hidden")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RoomEditor room={editing} open={editorOpen} onOpenChange={setEditorOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Page>
  )
}
