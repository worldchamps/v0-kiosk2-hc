"use client"

import { useEffect, useRef } from "react"

interface UseIdleTimerOptions {
  onIdle: () => void
  idleTime?: number // in milliseconds
  enabled?: boolean
}

export function useIdleTimer({ onIdle, idleTime = 60000, enabled = true }: UseIdleTimerOptions) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isCallingRef = useRef(false)

  const resetTimer = () => {
    // Clear existing timer
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set new timer only if enabled
    if (enabled) {
      timeoutRef.current = setTimeout(() => {
        if (isCallingRef.current) {
          console.log("[v0] Idle callback already in progress, skipping")
          return
        }

        isCallingRef.current = true
        console.log("[v0] Idle timeout reached, triggering onIdle callback")
        onIdle()
        // Reset after a delay to allow navigation to complete
        setTimeout(() => {
          isCallingRef.current = false
        }, 1000)
      }, idleTime)
    }
  }

  useEffect(() => {
    if (!enabled) {
      // Clear timer if disabled
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // Events to track user activity
    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"]

    // Reset timer on any user activity
    const handleActivity = () => {
      console.log("[v0] User activity detected, resetting idle timer")
      resetTimer()
    }

    // Add event listeners
    events.forEach((event) => {
      document.addEventListener(event, handleActivity)
    })

    // Start initial timer
    resetTimer()

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity)
      })
    }
  }, [enabled, idleTime, onIdle])

  return { resetTimer }
}
