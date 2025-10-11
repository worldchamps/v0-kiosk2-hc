"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            관리자 인증
          </DialogTitle>
          <DialogDescription>모드 변경을 위해 관리자 비밀번호를 입력해주세요.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {/* Replace the existing Input component with PasswordInput */}
            <PasswordInput value={inputPassword} onChange={setInputPassword} className="w-full" autoFocus />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={handleClose}>
              취소
            </Button>
            <Button type="submit">확인</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
