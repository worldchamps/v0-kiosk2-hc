"use client"

import { useEffect, useState } from "react"
import { getPropertyConfig, type PropertyConfig } from "./property-config"

/**
 * 현재 Property 정보를 가져오는 Hook
 */
export function useProperty() {
  const [config, setConfig] = useState<PropertyConfig | null>(null)

  useEffect(() => {
    setConfig(getPropertyConfig())
  }, [])

  return {
    propertyId: config?.id,
    propertyName: config?.name,
    useWebSerial: config?.useWebSerial,
    config,
  }
}
