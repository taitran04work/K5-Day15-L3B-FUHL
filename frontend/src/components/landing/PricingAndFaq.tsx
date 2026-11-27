import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { ArrowRight, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PlanItem {
  name: string
  desc: string
  priceMonthly: string
  priceAnnual: string
  highlighted?: boolean
  cta: string
  to: string
  features: string[]
}

interface FaqItem {
  q: string
  a: string
}

export function PricingAndFaq() {
  const { t } = useTranslation()
  const [annual, setAnnual] = useState(true)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const plans = t("landing.pricing.plans", { returnObjects: true }) as PlanItem[]
  const faqs = t("landing.faq.items", { returnObjects: true }) as FaqItem[]

  return (
    <>
      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t bg-canvas py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center rounded-full border bg-background px-3 py-1 text-xs font-medium text-brand">
              {t("landing.pricing.eyebrow")}
            </span>
            <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.pricing.title")}</h2>
            <p className="mt-3 text-base text-muted-foreground">{t("landing.pricing.subtitle")}</p>

            {/* Billing toggle */}
            <div className="mt-7 inline-flex items-center gap-1 rounded-xl border bg-background p-1 shadow-xs">
              <button
                type="button"
                onClick={() => setAnnual(false)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-xs font-medium transition-all duration-200",
                  !annual ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("landing.pricing.monthly")}
              </button>
              <button
                type="button"
                onClick={() => setAnnual(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all duration-200",
                  annual ? "bg-foreground text-background shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t("landing.pricing.annual")}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    annual ? "bg-brand text-brand-foreground" : "bg-brand-soft text-brand",
                  )}
                >
                  {t("landing.pricing.saveBadge")}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-background p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg sm:p-7",
                  plan.highlighted && "border-brand/60 ring-1 ring-brand/25 shadow-md",
                )}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-brand-foreground shadow-xs">
                    {t("landing.pricing.popular")}
                  </span>
                )}
                <div>
                  <h3 className="text-base font-semibold">{plan.name}</h3>
                  <p className="mt-1.5 min-h-[2.5rem] text-sm text-muted-foreground">{plan.desc}</p>
                </div>

                <div className="mt-5 flex items-baseline gap-1.5 border-b pb-6">
                  <span className="text-2xl font-semibold tabular tracking-tight">
                    {annual ? plan.priceAnnual : plan.priceMonthly}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("landing.pricing.perMonth")}</span>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  variant={plan.highlighted ? "default" : "outline"}
                  className="group mt-8 w-full"
                >
                  <Link to={plan.to}>
                    {plan.cta}
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">{t("landing.pricing.note")}</p>
        </div>
      </section>

      {/* FAQ Accordion */}
      <section id="faq" className="scroll-mt-20 border-t bg-background py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <span className="inline-flex items-center rounded-full border bg-canvas px-3 py-1 text-xs font-medium text-brand">
              {t("landing.faq.eyebrow")}
            </span>
            <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.faq.title")}</h2>
          </div>

          <div className="mt-10 space-y-3">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx
              return (
                <div
                  key={item.q}
                  className={cn(
                    "overflow-hidden rounded-xl border transition-colors duration-200",
                    isOpen ? "border-brand/35 bg-canvas/70" : "bg-card hover:border-foreground/20",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-foreground sm:text-base">{item.q}</span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-250",
                        isOpen && "rotate-180 text-brand",
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out",
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </>
  )
}
