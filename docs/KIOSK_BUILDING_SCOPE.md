# property3 A동 / B동 전용 키오스크

property3은 분리하지 않는다. 기존 PMS의 `kiosk_sales_config/property3` 요금·판매 정책,
예약 시트와 `pms_queue/property3` 경로는 그대로 사용한다. 각 키오스크의 로컬 서버가
PC 설정을 읽어 A동 또는 B동 객실만 허용한다. 별도 서버·유료 서비스는 추가하지 않는다.

## 각 PC의 설치 설정

기존 `.env.local`의 인증정보·프린터·결제단말기·COM 포트는 유지하고 아래 값을 지정한다.
이 파일은 Git이나 공용 설치파일에 포함하지 않는다.

| PC | KIOSK_PROPERTY_ID | NEXT_PUBLIC_KIOSK_PROPERTY_ID | KIOSK_BUILDING |
| --- | --- | --- | --- |
| A동 키오스크 | property3 | property3 | A |
| B동 키오스크 | property3 | property3 | B |

`KIOSK_BUILDING`은 대문자 A/B만 허용한다. property3에서 값이 없거나 잘못되면
화면에 설정 확인 안내를 표시하고 판매·체크인을 막는다. 임의로 A동이나 A/B 전체를 선택하지 않는다.
property1/2/4에는 동 설정을 요구하지 않으며 기존 예약 정책을 유지한다.

- 설치형: 최초 등록 화면에서 **그 PC의 설정 파일**을 가져온다. 동 설정도 기존 장비 설정과 함께
  Windows 암호화 저장소에 보관되고 앱 업데이트·재부팅 후 유지된다. 하나의 공용 설치파일을 사용한다.
- 소스 실행형: PC별 `.env.local` 설정 후 기존 절차대로 빌드·재시작한다.
- 이미 등록된 설치형 PC는 `.env.local`만 수정해도 저장된 설정이 갱신되지는 않는다.
  기존 등록/저장 파일을 삭제하거나 재등록하지 말고, 배포 전에 해당 PC의 저장된 설정을 별도로 확인한다.
- 신규 장비 ID는 각각 구분한다(예: `property3-a-kiosk-01`, `property3-b-kiosk-01`).
  이미 등록된 `property3-kiosk-01`이 어느 PC인지 추측해서 재발급하거나 교체하지 않는다.

## 적용 범위

- 현장 판매 목록: 해당 동 객실만 노출. 객실 상태·판매불가·숙박/대실·요금 정책은 기존대로 검사한다.
- 이름/예약번호(QR) 조회: 해당 동에 배정된 예약만 반환. 객실번호 A/B 접두사를 기준으로 판단한다.
  숫자만 있거나 미배정인 예약은 임의 추정하지 않고 관리자 확인 대상으로 남긴다.
- 체크인: 제출 시 예약 시트를 다시 읽고 동을 확인한다. 조회 이후 다른 동으로 재배정되어도 차단한다.
  기존 입실시간 검증을 유지하며 `adminOverride`도 동 제한을 해제하지 않는다.
- 현장예약: 결제 확인·예약 저장·객실 상태 변경·PMS 명령 추가 전에 객실 동을 검사한다.
- 온라인 결제 생성: 다른 동 상품의 결제 요청을 결제사 호출 전에 차단한다.
- 원격 영수증: 자기 숙소 대기열에서 자기 동 객실만 처리한다. 다른 동의 작업을 완료 처리하지 않는다.
  한 동에 여러 수신 PC를 동시에 운영하는 구성은 지원 범위가 아니다(요청 구성은 동별 1대).

브라우저 주소의 `/kiosk/A`, `/kiosk/B`, `location`, 로컬 저장값, 요청의 `kioskProperty`,
`searchAll`은 PC의 서버 설정을 바꿀 수 없다. 화면도 `/api/kiosk-config`에서 확인한 동을 사용한다.
이 API는 숙소·동만 반환하며 인증정보나 장비 등록 토큰은 내보내지 않는다.

키오스크는 기존 객실관리 PC와 다르다. 이번 변경으로 `pms_queue/property3`를 A/B PC로 나누거나
객실관리 명령 수신 프로그램을 키오스크에 설치하지 않는다. 기존 PMS 상태변경 명령 전달은 그대로다.

## 검증과 실제 반영

```powershell
node --experimental-strip-types --test tests/kiosk-building-scope.test.mts tests/reservation-check-in.test.mts tests/reservation-schedule.test.mts tests/kiosk-sales-config.test.mts
npm.cmd run test:updates
npm.cmd run build
```

테스트는 가짜 예약·결제·DB·프린터로 실행하며 운영 데이터나 장비에 명령을 보내지 않는다.
소스의 main 반영은 실제 PC 설치/업데이트가 아니다. 설치파일 제작 시 버전을 올리고,
기존 [비공개 장비별 업데이트 절차](KIOSK_REMOTE_UPDATES.md)를 따른다.

설치 승인 후 각 PC에서 `/api/kiosk-config` 값과 화면의 동을 확인한다. A/B 각각의 객실 목록,
승인된 안전한 테스트 예약의 체크인·결제·실물 영수증, 재부팅 후 설정 유지를 확인한 뒤 운영한다.
현장 확인 없이 설치·운영 완료로 보고하지 않는다.
