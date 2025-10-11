"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Copy, Check } from "lucide-react"

export default function DirectLinks() {
  const [copied, setCopied] = useState<string | null>(null)

  // 현재 도메인 가져오기
  const domain = typeof window !== "undefined" ? window.location.origin : ""

  // 각 위치별 링크
  const links = [
    { name: "A동 키오스크", url: `${domain}/kiosk/A` },
    { name: "B동 키오스크", url: `${domain}/kiosk/B` },
    { name: "D동 키오스크", url: `${domain}/kiosk/D` },
    { name: "더 캠프스테이 키오스크", url: `${domain}/kiosk/CAMP` },
    { name: "웹모드 (관리자)", url: `${domain}/web` },
  ]

  // 클립보드에 복사 함수
  const copyToClipboard = (text: string, name: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(name)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>직접 접속 링크</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500 mb-4">
          아래 링크를 사용하여 각 위치의 키오스크나 웹모드에 직접 접속할 수 있습니다.
        </p>

        <div className="space-y-3">
          {links.map((link) => (
            <div key={link.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
              <div>
                <p className="font-medium">{link.name}</p>
                <p className="text-sm text-blue-600 break-all">{link.url}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(link.url, link.name)}
                className="flex items-center gap-1"
              >
                {copied === link.name ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>복사됨</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>복사</span>
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-md text-sm text-blue-700">
          <p className="font-bold mb-2">사용 방법:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>위 링크를 복사하여 키오스크 브라우저의 주소창에 입력합니다.</li>
            <li>해당 위치의 키오스크 화면이 자동으로 표시됩니다.</li>
            <li>북마크로 저장하면 다음에 쉽게 접근할 수 있습니다.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
