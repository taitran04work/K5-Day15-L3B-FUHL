import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function GuestBackdrop({ image }: { image?: string | null }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[min(75rem,120dvh)] overflow-hidden">
      {image && <img src={image} alt="" className="size-full object-cover object-center opacity-65" decoding="async" />}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,12,18,0.68),rgba(8,12,18,0.55)_35%,var(--background)_100%)]" />
    </div>
  )
}

export function GuestPageHeading({ title, description, className }: { title: string; description?: ReactNode; className?: string }) {
  return (
    <header className={className}>
      <h1 className="font-display text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[1.08] text-foreground wrap-break-word">{title}</h1>
      {description && <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">{description}</p>}
    </header>
  )
}

export function GuestStateCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("guest-panel px-5 py-8 text-center sm:px-8 sm:py-10", className)}>{children}</div>
}
