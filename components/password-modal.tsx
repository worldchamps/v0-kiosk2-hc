"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import * as Dialog from "@radix-ui/react-dialog"
import { Lock } from "lucide-react"
import PasswordInput from "@/components/password-input"

interface PasswordModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  password: string
}

export default function PasswordModal({ isOpen, onClose, onConfirm, password }: PasswordModalProps) {
  const [inputPassword, setInputPassword] = useState("")
  const [error, setError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (inputPassword === password) {
      setInputPassword("")
      setError("")
      onConfirm()
    } else {
      setError("비밀번호가 일치하지 않습니다.")
    }
  }

  const handleClose = () => {
    setInputPassword("")
    setError("")
    onClose()
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 space-y-2">
          <Dialog.Title className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            관리자 인증
          </Dialog.Title>
          <Dialog.Description>모드 변경을 위해 관리자 비밀번호를 입력해주세요.</Dialog.Description>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {/* Replace the existing Input component with PasswordInput */}
            <PasswordInput value={inputPassword} onChange={setInputPassword} className="w-full" autoFocus />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              취소
            </Button>
            <Button type="submit">확인</Button>
          </div>
        </form>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
