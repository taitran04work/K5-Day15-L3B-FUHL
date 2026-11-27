import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowLeft, GripVertical, ImagePlus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, Field, PageHeader, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { AMENITY_KEYS } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { resizeToWebp } from "@/lib/image"
import { cn } from "@/lib/utils"
import type { Photo, Room } from "@/lib/types"

type RoomForm = Omit<Room, "id" | "photos" | "coverUrl" | "sortOrder">

const blank: RoomForm = {
  name: "",
  code: "",
  description: "",
  maxGuests: 2,
  baseGuests: 2,
  beds: "",
  areaM2: null,
  amenities: ["wifi"],
  isActive: true,
  supportsNightly: true,
  supportsHourly: false,
  baseNightlyPrice: 0,
  baseHourlyPrice: 0,
  minHours: 2,
  extraGuestFee: 0,
}

function SortablePhoto({ photo, roomId, onChanged }: { photo: Photo; roomId: string; onChanged: () => void }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id })
  const [caption, setCaption] = useState(photo.caption ?? "")
  const errorMessage = useErrorMessage()
  const save = useMutation({ mutationFn: () => api.put(`/api/app/rooms/${roomId}/photos/${photo.id}`, { caption }), onSuccess: onChanged })
  const cover = useMutation({ mutationFn: () => api.post(`/api/app/rooms/${roomId}/photos/${photo.id}/cover`), onSuccess: onChanged })
  const del = useMutation({
    mutationFn: () => api.del(`/api/app/rooms/${roomId}/photos/${photo.id}`),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("overflow-hidden rounded-lg border bg-background", isDragging && "z-10 shadow-lg")}
    >
      <div className="relative aspect-[4/3] bg-muted">
        <img src={photo.url} alt={photo.caption ?? ""} className="size-full object-cover" />
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="absolute left-2 top-2 flex size-7 cursor-grab items-center justify-center rounded-md bg-background/90 text-foreground active:cursor-grabbing"
          aria-label={t("rooms.dragToReorder")}
        >
          <GripVertical className="size-4" />
        </button>
        {photo.isCover && (
          <span className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium">{t("rooms.cover")}</span>
        )}
      </div>
      <div className="space-y-2 p-2.5">
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (photo.caption ?? "") && save.mutate()}
          placeholder={t("rooms.caption")}
          aria-label={t("rooms.caption")}
          className="h-8 text-xs"
        />
        <div className="flex items-center justify-between">
          <Button size="xs" variant="ghost" onClick={() => cover.mutate()} disabled={photo.isCover || cover.isPending}>
            <Star /> {t("rooms.setCover")}
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={() => del.mutate()} disabled={del.isPending} aria-label={t("rooms.deletePhoto")}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  )
}

function RoomPhotosPanel({ roomId, photos }: { roomId: string; photos: Photo[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [order, setOrder] = useState<Photo[]>(photos)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    setOrder(photos)
  }, [photos])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["room", roomId] })
    void qc.invalidateQueries({ queryKey: ["rooms"] })
  }

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      for (const f of files) form.append("files", await resizeToWebp(f))
      return api.upload<Photo[]>(`/api/app/rooms/${roomId}/photos`, form)
    },
    onSuccess: () => {
      toast.success(t("rooms.photosUploaded"))
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put(`/api/app/rooms/${roomId}/photos/order`, { ids }),
    onSuccess: refresh,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const next = arrayMove(order, order.findIndex((p) => p.id === e.active.id), order.findIndex((p) => p.id === e.over!.id))
    setOrder(next)
    reorder.mutate(next.map((p) => p.id))
  }

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"))
    if (list.length) upload.mutate(list)
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          pick(e.dataTransfer.files)
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-7 text-center transition-colors",
          dragOver && "border-brand bg-brand-soft",
        )}
      >
        <ImagePlus className="size-5 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">{t("rooms.dropPhotos")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("rooms.photoHint")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending && <Spinner />} {t("rooms.choosePhotos")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {order.length === 0 ? (
        <EmptyState title={t("rooms.noPhotos")} description={t("rooms.noPhotosHint")} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {order.map((p) => (
                <SortablePhoto key={p.id} photo={p} roomId={roomId} onChanged={refresh} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

export default function RoomDetail() {
  const { roomId } = useParams()
  const isNew = !roomId
  const navigate = useNavigate()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()

  const room = useQuery({
    queryKey: ["room", roomId],
    enabled: !!roomId,
    queryFn: () => api.get<Room>(`/api/app/rooms/${roomId}`),
  })

  const [form, setForm] = useState<RoomForm>(blank)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (isNew) {
      setForm(blank)
    } else if (room.data) {
      setForm({ ...blank, ...room.data, description: room.data.description ?? "", beds: room.data.beds ?? "" })
    }
  }, [isNew, room.data])

  const set = <K extends keyof RoomForm>(k: K, v: RoomForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === "" ? 0 : Number(v))

  const save = useMutation({
    mutationFn: () => (roomId ? api.put<Room>(`/api/app/rooms/${roomId}`, form) : api.post<Room>("/api/app/rooms", form)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["rooms"] })
      if (isNew) {
        toast.success(t("rooms.createdAddPhotos"))
        navigate(`/app/rooms/${r.id}`, { replace: true })
      } else {
        void qc.invalidateQueries({ queryKey: ["room", roomId] })
        toast.success(t("common.saved"))
      }
    },
  })

  const del = useMutation({
    mutationFn: () => api.del<{ archived: boolean }>(`/api/app/rooms/${roomId}`),
    onSuccess: (r) => {
      toast.success(r.archived ? t("rooms.archived") : t("rooms.deleted"))
      void qc.invalidateQueries({ queryKey: ["rooms"] })
      navigate("/app/rooms", { replace: true })
    },
  })

  if (!isNew && room.error) {
    return (
      <Page>
        <ErrorState error={room.error} onRetry={() => void room.refetch()} />
      </Page>
    )
  }

  return (
    <Page>
      <div className="mb-3">
        <Link to="/app/rooms" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />
          <span>{t("rooms.backToList")}</span>
        </Link>
      </div>

      <PageHeader
        title={isNew ? t("rooms.newRoom") : form.name || room.data?.name || t("rooms.editRoom")}
        description={isNew ? t("rooms.newDescription") : t("rooms.editDescription")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/rooms">{t("common.cancel")}</Link>
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || (!isNew && room.isLoading)}>
              {save.isPending && <Spinner />} {isNew ? t("rooms.createRoom") : t("common.save")}
            </Button>
          </>
        }
      />

      {!isNew && room.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
          <div className="space-y-6">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
          <div className="space-y-6">
            <Section title={t("rooms.details")}>
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <Field label={t("rooms.name")} htmlFor="room-name" error={fieldError(save.error, "name")}>
                    <Input id="room-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
                  </Field>
                  <Field label={t("rooms.code")} htmlFor="room-code" error={fieldError(save.error, "code")}>
                    <Input
                      id="room-code"
                      value={form.code}
                      onChange={(e) => set("code", e.target.value.toUpperCase())}
                      className="font-mono uppercase"
                    />
                  </Field>
                </div>

                <Field label={t("rooms.descriptionLabel")} htmlFor="room-desc" optional>
                  <Textarea id="room-desc" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("rooms.maxGuests")} htmlFor="room-max-guests" error={fieldError(save.error, "maxGuests")}>
                    <Input
                      id="room-max-guests"
                      type="number"
                      min={1}
                      value={form.maxGuests}
                      onChange={(e) => set("maxGuests", num(e.target.value))}
                      className="tabular"
                    />
                  </Field>
                  <Field label={t("rooms.baseGuests")} htmlFor="room-base-guests" error={fieldError(save.error, "baseGuests")}>
                    <Input
                      id="room-base-guests"
                      type="number"
                      min={1}
                      value={form.baseGuests}
                      onChange={(e) => set("baseGuests", num(e.target.value))}
                      className="tabular"
                    />
                  </Field>
                  <Field label={t("rooms.beds")} htmlFor="room-beds" optional>
                    <Input id="room-beds" value={form.beds ?? ""} onChange={(e) => set("beds", e.target.value)} />
                  </Field>
                  <Field label={t("rooms.area")} htmlFor="room-area" optional>
                    <Input
                      id="room-area"
                      type="number"
                      min={0}
                      value={form.areaM2 ?? ""}
                      onChange={(e) => set("areaM2", e.target.value === "" ? null : Number(e.target.value))}
                      className="tabular"
                    />
                  </Field>
                </div>
              </div>
            </Section>

            <Section title={t("rooms.pricingSection")}>
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="room-nightly" className="flex-1 cursor-pointer">
                    <span className="block text-sm font-medium">{t("rooms.nightly")}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{t("rooms.nightlyHint")}</span>
                  </Label>
                  <Switch id="room-nightly" checked={form.supportsNightly} onCheckedChange={(v) => set("supportsNightly", v)} />
                </div>
                {form.supportsNightly && (
                  <Field label={t("rooms.nightlyPrice")} htmlFor="room-nightly-price" error={fieldError(save.error, "baseNightlyPrice")}>
                    <Input
                      id="room-nightly-price"
                      type="number"
                      min={0}
                      step={10000}
                      value={form.baseNightlyPrice || ""}
                      onChange={(e) => set("baseNightlyPrice", num(e.target.value))}
                      className="tabular"
                    />
                  </Field>
                )}

                <div className="flex items-center justify-between gap-4 border-t pt-5">
                  <Label htmlFor="room-hourly" className="flex-1 cursor-pointer">
                    <span className="block text-sm font-medium">{t("rooms.hourly")}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{t("rooms.hourlyHint")}</span>
                  </Label>
                  <Switch id="room-hourly" checked={form.supportsHourly} onCheckedChange={(v) => set("supportsHourly", v)} />
                </div>
                {form.supportsHourly && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t("rooms.hourlyPrice")} htmlFor="room-hourly-price" error={fieldError(save.error, "baseHourlyPrice")}>
                      <Input
                        id="room-hourly-price"
                        type="number"
                        min={0}
                        step={10000}
                        value={form.baseHourlyPrice || ""}
                        onChange={(e) => set("baseHourlyPrice", num(e.target.value))}
                        className="tabular"
                      />
                    </Field>
                    <Field label={t("rooms.minHours")} htmlFor="room-min-hours" error={fieldError(save.error, "minHours")}>
                      <Input
                        id="room-min-hours"
                        type="number"
                        min={1}
                        max={12}
                        value={form.minHours}
                        onChange={(e) => set("minHours", num(e.target.value))}
                        className="tabular"
                      />
                    </Field>
                  </div>
                )}

                {fieldError(save.error, "supportsNightly") && (
                  <p className="text-xs text-destructive">{fieldError(save.error, "supportsNightly")}</p>
                )}

                <div className="border-t pt-5">
                  <Field label={t("rooms.extraGuestFee")} htmlFor="room-extra-fee" hint={t("rooms.extraGuestHint", { count: form.baseGuests })}>
                    <Input
                      id="room-extra-fee"
                      type="number"
                      min={0}
                      step={10000}
                      value={form.extraGuestFee || ""}
                      onChange={(e) => set("extraGuestFee", num(e.target.value))}
                      className="tabular"
                    />
                  </Field>
                </div>
              </div>
            </Section>

            <Section title={t("rooms.amenities")}>
              <div className="flex flex-wrap gap-2">
                {[...new Set([...AMENITY_KEYS, ...form.amenities])].map((a) => {
                  const on = form.amenities.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("amenities", on ? form.amenities.filter((x) => x !== a) : [...form.amenities, a])}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                        on ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`amenity.${a}`, { defaultValue: a.replace(/_/g, " ") })}
                    </button>
                  )
                })}
              </div>
            </Section>

            {save.error && !Object.keys((save.error as { errors?: object }).errors ?? {}).length && (
              <p className="text-sm text-destructive">{errorMessage(save.error)}</p>
            )}
          </div>

          <div className="space-y-6">
            <Section title={t("rooms.col.status")}>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="room-active" className="flex-1 cursor-pointer">
                  <span className="block text-sm font-medium">{t("rooms.bookable")}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t("rooms.bookableHint")}</span>
                </Label>
                <Switch id="room-active" checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
              </div>
            </Section>

            <Section title={t("rooms.photos")}>
              {roomId && room.data ? (
                <RoomPhotosPanel roomId={roomId} photos={room.data.photos} />
              ) : (
                <EmptyState title={t("rooms.noPhotos")} description={t("rooms.photosPendingHint")} />
              )}
            </Section>

            {roomId && (
              <div className="flex items-center justify-between rounded-xl border border-destructive/25 bg-card px-5 py-4">
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium text-destructive">{t("rooms.delete")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("rooms.deleteDescription")}</p>
                </div>
                <Button variant="outline" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  {t("rooms.delete")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rooms.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rooms.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}
