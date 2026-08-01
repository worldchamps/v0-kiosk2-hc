import type { ReactNode } from "react"

export const ON_SITE_PROGRESS_STEPS = ["객실 선택", "입실 전 확인사항", "체크인"] as const
export const RESERVATION_PROGRESS_STEPS = ["예약 확인", "입실 전 확인사항", "체크인"] as const

interface KioskProgressProps {
  steps: readonly string[]
  currentStep: number
}

export default function KioskProgress({ steps, currentStep }: KioskProgressProps) {
  return (
    <nav className="kiosk-process-progress" aria-label="진행 단계">
      {steps.map((label, index) => (
        <div key={label} className="kiosk-process-progress-part">
          <span
            className={`kiosk-process-progress-step ${
              index === currentStep ? "is-current" : index < currentStep ? "is-complete" : ""
            }`}
            aria-current={index === currentStep ? "step" : undefined}
          >
            {label}
          </span>
        </div>
      ))}
    </nav>
  )
}

interface KioskProgressScreenProps extends KioskProgressProps {
  children: ReactNode
}

export function KioskProgressScreen({ steps, currentStep, children }: KioskProgressScreenProps) {
  return (
    <div className="kiosk-process-screen">
      <KioskProgress steps={steps} currentStep={currentStep} />
      <div className="kiosk-process-body">{children}</div>
    </div>
  )
}
