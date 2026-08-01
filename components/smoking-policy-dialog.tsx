"use client"

import { CigaretteOff, ShieldAlert } from "lucide-react"
import KioskProgress, { RESERVATION_PROGRESS_STEPS } from "@/components/kiosk-progress"

interface SmokingPolicyDialogProps {
  open: boolean
  onAgree: () => void
  onCancel: () => void
  actionLabel: string
  cancelLabel?: string
}

export default function SmokingPolicyDialog({
  open,
  onAgree,
  onCancel,
  actionLabel,
  cancelLabel = "취소",
}: SmokingPolicyDialogProps) {
  if (!open) return null

  return (
    <div className="kiosk-smoking-dialog-backdrop" role="presentation">
      <KioskProgress steps={RESERVATION_PROGRESS_STEPS} currentStep={1} />
      <div
        className="kiosk-smoking-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-smoking-dialog-title"
        aria-describedby="kiosk-smoking-dialog-description"
      >
        <div className="kiosk-smoking-dialog-icon">
          <CigaretteOff />
        </div>

        <div className="kiosk-smoking-dialog-copy">
          <p>체크인 전 필수 확인</p>
          <h2 id="kiosk-smoking-dialog-title">전 객실은 금연입니다</h2>
          <div id="kiosk-smoking-dialog-description">
            <ShieldAlert />
            <span>
              객실 내 흡연 시 청소비와 시설 손해배상 비용이 청구될 수 있습니다.
            </span>
          </div>
        </div>

        <div className="kiosk-smoking-dialog-actions">
          <button type="button" className="kiosk-smoking-dialog-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="kiosk-smoking-dialog-agree" onClick={onAgree}>
            금연에 동의하고 {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
