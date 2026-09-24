# 키오스크 AI 도우미

모든 키오스크 고객 화면의 오른쪽 아래에서 `AI 도우미`를 열 수 있습니다. 화면을 닫으면 예약과 결제 화면의 입력은 유지됩니다. `음성 대화 시작`을 한 번 누르면 자동으로 말의 끝을 감지하고 답변 음성과 자막을 스트리밍합니다. 답변 중 다시 말하면 기존 음성을 끊고 새 질문을 받습니다. `음성 대화 끝내기`, 창 닫기, 연결 끊김 또는 3분 제한에 도달하면 마이크와 연결을 해제합니다.

실시간 음성은 OpenAI Realtime `gpt-realtime-2.1`과 브라우저의 WebRTC를 사용합니다. 서버에 `OPENAI_API_KEY`를 설정하고 HTTPS 또는 localhost에서 엽니다. 서버는 짧게 유효한 클라이언트 키만 브라우저에 전달합니다. 원본 API 키를 브라우저나 Git에 넣지 않습니다. 음성 모델은 허용된 주제를 선택하는 안내 조회 도구를 호출하고, 서버가 반환한 고정 안내만 읽도록 지시받습니다. 음성 표현과 지연 시간은 실제 장비에서 확인해야 합니다.

글자 질문은 기존 TypeSafe Jev `jev-latest`를 사용하므로 `TYPESAFE_API_KEY`가 필요합니다. 글자 답변 다시 듣기는 `GEMINI_API_KEY`가 있을 때 Gemini `gemini-3.8-flash-lite-tts`를 사용합니다. 실시간 음성 경로는 Jev와 Gemini를 거치지 않습니다.

기본 음색은 `marin`이고, 기본 말투는 사용자가 요청한 “빠르되 차분하고 친절한 호텔 안내, 20대 여성 느낌”입니다. 이는 발화 스타일 지시이며 목소리의 정확한 나이를 보장하는 설정은 아닙니다. 서버의 `KIOSK_ASSISTANT_VOICE`로 음색(`marin`, `cedar`, `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`)을 고르고, `KIOSK_ASSISTANT_VOICE_STYLE`로 말투(`calm`, `friendly`, `concise`)를 고릅니다. 음색 변경은 새 음성 대화부터 적용됩니다.

`객실 있나요?`는 기존 판매 가능 객실 API를 서버에서 호출하며 해당 키오스크의 숙소·동으로 결과를 제한합니다. 결제 질문에는 결과가 확실하지 않을 때 추가 결제를 권하지 않습니다. 도우미는 예약 생성, 결제, 체크인, 취소, 환불을 실행하지 않습니다. 계좌이체 처리, 키 수령, 이동 경로, 퇴실 시간은 숙소별 운영 문구를 확정하기 전까지 키오스크에 이미 표시된 정보와 관리자 문의로 안내합니다.

검증: `npm.cmd run typecheck`, `npm.cmd run test:qa`, `npm.cmd run build`. 실제 장비에서 마이크 권한, 연속 질문, 답변 도중 끼어들기, 자막, 음색·속도, 창 닫기 후 마이크 해제, 화면 복귀, 숙소·동별 객실 답변을 확인합니다. API 키가 없는 개발 환경의 자동 검사는 모델 연결과 물리 마이크를 증명하지 않습니다. [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [음성 스타일](https://developers.openai.com/api/docs/guides/voice-prompting).

## Vercel Preview 음성 테스트

기존 Vercel 프로젝트에서 GitHub `codex/kiosk-voice-preview` 브랜치를 Preview로 배포합니다. 이 브랜치의 Preview 환경에서는 AI 안내 API와 키오스크 설정 조회만 허용하며, 예약·체크인·판매·결제·객실 조회 API는 차단합니다. 음성 안내의 객실 현황도 운영 Firebase를 읽지 않고 확인 불가로 답합니다. Vercel 환경 변수에 `OPENAI_API_KEY`를 Preview 범위로 추가합니다. 기존 키오스크 설정이 없는 프로젝트라면 `property3` 테스트에 `KIOSK_BUILDING=A` 또는 `B`도 필요합니다. Preview 주소는 Vercel Authentication으로 보호합니다.

Vercel Logs에서 `[kiosk-ai-preview]`를 검색하면 음성 연결 상태, 질문·안내 문구, 주제, 응답 시간, 오류를 세션 ID로 묶어 확인할 수 있습니다. 원본 음성·API 키·결제 정보는 기록하지 않습니다. 실제 개인정보 대신 테스트 문장만 사용합니다. Hobby 플랜의 런타임 로그 보관 기간은 1시간이므로 필요한 로그는 테스트 직후 확인합니다.
