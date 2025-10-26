"use client"

import { useEffect, useState } from "react"
import { ref, onValue, update, off } from "firebase/database"
import { getFirebaseDatabase } from "@/lib/firebase-client"
import { printRoomInfoReceipt, isPrinterConnected, autoConnectPrinter } from "@/lib/printer-utils"

interface PrintJob {
  id: string
  action: string
  roomNumber: string
  password: string
  status: "pending" | "completed"
  property: string
  createdAt: string
  completedAt: string | null
}

export function PrintQueueListener() {
  const [pendingJobs, setPendingJobs] = useState<number>(0)
  const [lastPrintTime, setLastPrintTime] = useState<string>("")
  const [isPopupMode, setIsPopupMode] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const popupMode = localStorage.getItem("popupMode") === "true"
      setIsPopupMode(popupMode)

      if (popupMode) {
        console.log("[PrintQueue] Popup mode detected, skipping print queue listener")
        return
      }
    }

    const database = getFirebaseDatabase()
    if (!database) {
      console.warn("[PrintQueue] Firebase database not available, skipping print queue listener")
      return
    }

    console.log("[PrintQueue] Initializing print queue listener...")

    autoConnectPrinter().then((connected) => {
      if (connected) {
        console.log("[PrintQueue] Printer auto-connected successfully")
      } else {
        console.log("[PrintQueue] Printer not connected, will retry when print job arrives")
      }
    })

    const property3Ref = ref(database, "print_queue/property3")
    const property4Ref = ref(database, "print_queue/property4")

    const handlePrintJob = async (property: string, jobId: string, job: PrintJob) => {
      if (job.status === "pending" && job.action === "remote-print") {
        console.log(`[PrintQueue] New print job detected in ${property}:`, job)

        if (!isPrinterConnected()) {
          console.log("[PrintQueue] Printer not connected, attempting to connect...")
          const connected = await autoConnectPrinter()
          if (!connected) {
            console.error("[PrintQueue] Failed to connect printer")
            return
          }
        }

        const roomNumber = job.roomNumber
        let floor = "1F"
        if (roomNumber.length >= 2) {
          const floorDigit = roomNumber.charAt(1)
          if (floorDigit >= "1" && floorDigit <= "9") {
            floor = `${floorDigit}F`
          }
        }

        const printData = {
          roomNumber: job.roomNumber,
          password: job.password,
          floor: floor,
        }

        console.log("[PrintQueue] Printing receipt with data:", printData)
        const success = await printRoomInfoReceipt(printData)

        if (success) {
          console.log("[PrintQueue] Print successful, updating status...")
          const jobRef = ref(database, `print_queue/${property}/${jobId}`)
          await update(jobRef, {
            status: "completed",
            completedAt: new Date().toISOString(),
          })

          setLastPrintTime(new Date().toLocaleTimeString())
          console.log("[PrintQueue] Print job completed successfully")
        } else {
          console.error("[PrintQueue] Print failed")
        }
      }
    }

    const property3Listener = onValue(property3Ref, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        let pending = 0
        Object.entries(data).forEach(([jobId, job]) => {
          const printJob = job as PrintJob
          if (printJob.status === "pending") {
            pending++
            handlePrintJob("property3", jobId, printJob)
          }
        })
        setPendingJobs((prev) => prev + pending)
      }
    })

    const property4Listener = onValue(property4Ref, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        let pending = 0
        Object.entries(data).forEach(([jobId, job]) => {
          const printJob = job as PrintJob
          if (printJob.status === "pending") {
            pending++
            handlePrintJob("property4", jobId, printJob)
          }
        })
        setPendingJobs((prev) => prev + pending)
      }
    })

    return () => {
      console.log("[PrintQueue] Cleaning up print queue listeners...")
      off(property3Ref)
      off(property4Ref)
    }
  }, [])

  if (isPopupMode) {
    return null
  }

  if (pendingJobs === 0 && !lastPrintTime) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 bg-background/80 backdrop-blur-sm border rounded-lg p-3 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-muted-foreground">원격 프린트 대기중</span>
      </div>
      {lastPrintTime && <div className="text-muted-foreground mt-1">마지막 출력: {lastPrintTime}</div>}
    </div>
  )
}
