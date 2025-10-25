"use client"

import { useProperty } from "@/lib/use-property"

/**
 * 현재 Property를 표시하는 컴포넌트
 */
export function PropertyIndicator() {
  const { propertyName, useWebSerial } = useProperty()

  if (!propertyName) return null

  return (
    <div className="fixed top-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm font-medium">
      {propertyName} {useWebSerial ? "(Web)" : "(Electron)"}
    </div>
  )
}
