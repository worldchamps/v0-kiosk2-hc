"use client"

import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import RoomInfo from "@/components/room-info"
import PrinterTest from "@/components/printer-test"
import BillAcceptorTest from "@/components/bill-acceptor-test"
import BillDispenserTest from "@/components/bill-dispenser-test"
import RoomTypeSettings from "@/components/room-type-settings"
import DeviceStatus from "@/components/device-status"

export default function WebLayout({ onChangeMode }: { onChangeMode: () => void }) {
  return (
    <div className="flex flex-col h-screen">
      <header className="bg-gray-100 p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">관리자 모드</h1>
        <Button onClick={onChangeMode} variant="outline">
          모드 변경
        </Button>
      </header>

      <main className="flex-grow p-4 overflow-auto">
        <Tabs defaultValue="roomInfo" className="w-full">
          <TabsList>
            <TabsTrigger value="roomInfo">객실 정보</TabsTrigger>
            <TabsTrigger value="printer">프린터 테스트</TabsTrigger>
            <TabsTrigger value="billAcceptor">지폐 인식기</TabsTrigger>
            <TabsTrigger value="billDispenser">지폐 방출기</TabsTrigger>
            <TabsTrigger value="roomTypeSettings">객실 타입 설정</TabsTrigger>
            <TabsTrigger value="deviceStatus">기기 연결 상태</TabsTrigger>
          </TabsList>
          <TabsContent value="roomInfo">
            <RoomInfo reservations={[]} />
          </TabsContent>
          <TabsContent value="printer">
            <PrinterTest />
          </TabsContent>
          <TabsContent value="billAcceptor">
            <BillAcceptorTest />
          </TabsContent>
          <TabsContent value="billDispenser">
            <BillDispenserTest />
          </TabsContent>
          <TabsContent value="roomTypeSettings">
            <RoomTypeSettings />
          </TabsContent>
          <TabsContent value="deviceStatus">
            <DeviceStatus />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
