"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Eye, EyeOff } from "lucide-react"

interface PasswordInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  autoFocus?: boolean
}

export default function PasswordInput({
  value,
  onChange,
  placeholder = "비밀번호 입력",
  className = "",
  disabled = false,
  id = "password",
  autoFocus = false,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`pr-10 ${className}`}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
        onClick={() => setShowPassword(!showPassword)}
        disabled={disabled}
        tabIndex={-1}
      >
        {showPassword ? <EyeOff className="h-4 w-4 text-gray-500" /> : <Eye className="h-4 w-4 text-gray-500" />}
        <span className="sr-only">{showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}</span>
      </Button>
    </div>
  )
}
