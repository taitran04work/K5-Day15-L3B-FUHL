import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, ImagePlus, Star, Trash2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { EmptyState, Field, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { AMENITY_KEYS } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { resizeToWebp } from "@/lib/image"
import { cn } from "@/lib/utils"
import type { Photo, Room } from "@/lib/types"

type RoomForm = Omit<Room, "id" | "photos" | "coverUrl" | "sortOrder">

const blank: RoomForm = {
  name: "", code: "", description: "", maxGuests: 2, baseGuests: 2, beds: "", areaM2: null, amenities: ["wifi"], isActive: true,
  supportsNightly: true, supportsHourly: false, baseNightlyPrice: 0, baseHourlyPrice: 0, minHours: 2, extraGuestFee: 0,
}

function SortablePhoto({ photo, roomId, onChanged }: { photo: Photo; roomId: string; onChanged: () => void }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id })
  const [caption, setCaption] = useState(photo.caption ?? "")
  const errorMessage = useErrorMessage()
  const save = useMutation({ mutationFn: () => api.put(`/api/app/rooms/${roomId}/photos/${photo.id}`, { caption }), onSuccess: onChanged })
  const cover = useMutation({ mutationFn: () => api.post(`/api/app/rooms/${roomId}/photos/${photo.id}/cover`), onSuccess: onChanged })
  const del = useMutation({ mutationFn: () => api.del(`/api/app/rooms/${roomId}/photos/${photo.id}`), onSuccess: onChanged, onError: (e) => toast.error(errorMessage(e)) })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("overflow-hidden rounded-lg border bg-background", isDragging && "z-10 shadow-lg")}>
      <div className="relative aspect-[4/3] bg-muted">
        <img src={photo.url} alt={photo.caption ?? ""} className="size-full object-cover" />
        <button
          {...attributes}
          {...listeners}
          className="absolute left-2 top-2 flex size-7 cursor-grab items-center justify-center rounded-md bg-background/90 text-foreground active:cursor-grabbing"
          aria-label={t("rooms.dragToReorder")}
        >
          <GripVertical className="size-4" />
        </button>
        {photo.isCover && <span className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-0.5 text-xs font-medium">{t("rooms.cover")}</span>}
      </div>
      <div className="space-y-2 p-2">
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (photo.caption ?? "") && save.mutate()}
          placeholder={t("rooms.caption")}
          aria-label={t("rooms.caption")}
          className="h-8 text-xs"
        />
        <div className="flex justify-between">
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

function PhotosTab({ roomId }: { roomId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const inputRef = useRef<HTMLInputElement>(null)
  const room = useQuery({ queryKey: ["room", roomId], queryFn: () => api.get<Room>(`/api/app/rooms/${roomId}`) })
  const [order, setOrder] = useState<Photo[]>([])
  const [dragOver, setDragOver] = useState(false)
  useEffect(() => {
    if (room.data) setOrder(room.data.photos)
  }, [room.data])
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
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put(`/api/app/rooms/${roomId}/photos/order`, { ids }), onSuccess: refresh })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

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
        className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors", dragOver && "border-brand bg-brand-soft")}
      >
        <ImagePlus className="size-5 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">{t("rooms.dropPhotos")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("rooms.photoHint")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending && <Spinner />} {t("rooms.choosePhotos")}
        </Button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = "" }} />
      </div>
      {room.isLoading ? null : order.length === 0 ? (
        <EmptyState title={t("rooms.noPhotos")} description={t("rooms.noPhotosHint")} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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

export function RoomEditor({ room, open, onOpenChange }: { room: Room | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [form, setForm] = useState<RoomForm>(blank)
  const [tab, setTab] = useState("details")
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const roomId = room?.id ?? createdId

  useEffect(() => {
    if (!open) return
    setTab("details")
    setCreatedId(null)
    setForm(room ? { ...blank, ...room, description: room.description ?? "", beds: room.beds ?? "" } : blank)
  }, [open, room])

  const set = <K extends keyof RoomForm>(k: K, v: RoomForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => (roomId ? api.put<Room>(`/api/app/rooms/${roomId}`, form) : api.post<Room>("/api/app/rooms", form)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["rooms"] })
      if (!roomId) {
        setCreatedId(r.id)
        setTab("photos")
        toast.success(t("rooms.createdAddPhotos"))
      } else {
        toast.success(t("common.saved"))
        onOpenChange(false)
      }
    },
  })
  const del = useMutation({
    mutationFn: () => api.del<{ archived: boolean }>(`/api/app/rooms/${roomId}`),
    onSuccess: (r) => {
      toast.success(r.archived ? t("rooms.archived") : t("rooms.deleted"))
      void qc.invalidateQueries({ queryKey: ["rooms"] })
      onOpenChange(false)
    },
  })

  const num = (v: string) => (v === "" ? 0 : Number(v))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>{roomId ? form.name || t("rooms.editRoom") : t("rooms.newRoom")}</SheetTitle>
          <SheetDescription>{roomId ? t("rooms.editDescription") : t("rooms.newDescription")}</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="px-6 py-5">
          <TabsList>
            <TabsTrigger value="details">{t("rooms.details")}</TabsTrigger>
            <TabsTrigger value="photos" disabled={!roomId}>
              {t("rooms.photos")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="mt-5 space-y-6">
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label={t("rooms.name")} htmlFor="name" error={fieldError(save.error, "name")}>
                <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label={t("rooms.code")} htmlFor="code" error={fieldError(save.error, "code")}>
                <Input id="code" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} className="font-mono uppercase" />
              </Field>
            </div>
            <Field label={t("rooms.descriptionLabel")} htmlFor="desc" optional>
              <Textarea id="desc" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label={t("rooms.maxGuests")} error={fieldError(save.error, "maxGuests")}>
                <Input type="number" min={1} value={form.maxGuests} onChange={(e) => set("maxGuests", num(e.target.value))} className="tabular" />
              </Field>
              <Field label={t("rooms.baseGuests")} error={fieldError(save.error, "baseGuests")}>
                <Input type="number" min={1} value={form.baseGuests} onChange={(e) => set("baseGuests", num(e.target.value))} className="tabular" />
              </Field>
              <Field label={t("rooms.beds")} optional>
                <Input value={form.beds ?? ""} onChange={(e) => set("beds", e.target.value)} />
              </Field>
              <Field label={t("rooms.area")} optional>
                <Input type="number" min={0} value={form.areaM2 ?? ""} onChange={(e) => set("areaM2", e.target.value === "" ? null : Number(e.target.value))} className="tabular" />
              </Field>
            </div>

            <div className="space-y-4 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="nightly" className="flex-1">
                  <span className="block text-sm font-medium">{t("rooms.nightly")}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t("rooms.nightlyHint")}</span>
                </Label>
                <Switch id="nightly" checked={form.supportsNightly} onCheckedChange={(v) => set("supportsNightly", v)} />
              </div>
              {form.supportsNightly && (
                <Field label={t("rooms.nightlyPrice")} error={fieldError(save.error, "baseNightlyPrice")}>
                  <Input type="number" min={0} step={10000} value={form.baseNightlyPrice || ""} onChange={(e) => set("baseNightlyPrice", num(e.target.value))} className="tabular" />
                </Field>
              )}
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <Label htmlFor="hourly" className="flex-1">
                  <span className="block text-sm font-medium">{t("rooms.hourly")}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{t("rooms.hourlyHint")}</span>
                </Label>
                <Switch id="hourly" checked={form.supportsHourly} onCheckedChange={(v) => set("supportsHourly", v)} />
              </div>
              {form.supportsHourly && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("rooms.hourlyPrice")} error={fieldError(save.error, "baseHourlyPrice")}>
                    <Input type="number" min={0} step={10000} value={form.baseHourlyPrice || ""} onChange={(e) => set("baseHourlyPrice", num(e.target.value))} className="tabular" />
                  </Field>
                  <Field label={t("rooms.minHours")} error={fieldError(save.error, "minHours")}>
                    <Input type="number" min={1} max={12} value={form.minHours} onChange={(e) => set("minHours", num(e.target.value))} className="tabular" />
                  </Field>
                </div>
              )}
              {fieldError(save.error, "supportsNightly") && <p className="text-xs text-destructive">{fieldError(save.error, "supportsNightly")}</p>}
              <div className="border-t pt-4">
                <Field label={t("rooms.extraGuestFee")} hint={t("rooms.extraGuestHint", { count: form.baseGuests })}>
                  <Input type="number" min={0} step={10000} value={form.extraGuestFee || ""} onChange={(e) => set("extraGuestFee", num(e.target.value))} className="tabular" />
                </Field>
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-medium">{t("rooms.amenities")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...new Set([...AMENITY_KEYS, ...form.amenities])].map((a) => {
                  const on = form.amenities.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("amenities", on ? form.amenities.filter((x) => x !== a) : [...form.amenities, a])}
                      className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                    >
                      {t(`amenity.${a}`, { defaultValue: a.replace(/_/g, " ") })}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
              <Label htmlFor="active" className="flex-1">
                <span className="block text-sm font-medium">{t("rooms.bookable")}</span>
                <span className="block text-xs font-normal text-muted-foreground">{t("rooms.bookableHint")}</span>
              </Label>
              <Switch id="active" checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
            </div>
            {save.error && !Object.keys((save.error as { errors?: object }).errors ?? {}).length && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
          </TabsContent>
          <TabsContent value="photos" className="mt-5">
            {roomId && <PhotosTab roomId={roomId} />}
          </TabsContent>
        </Tabs>
        <SheetFooter className="sticky bottom-0 flex-row justify-between border-t bg-background px-6 py-4">
          {roomId ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              {t("rooms.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tab === "photos" ? t("common.done") : t("common.cancel")}
            </Button>
            {tab === "details" && (
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Spinner />} {roomId ? t("common.save") : t("rooms.createRoom")}
              </Button>
            )}
          </div>
        </SheetFooter>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("rooms.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("rooms.deleteDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-white hover:bg-destructive/90">
                {t("rooms.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
