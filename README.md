# Kiosk2

*Automatically synced with your [v0.dev](https://v0.dev) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/worldclasskiosks-projects/v0-kiosk2)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.dev-black?style=for-the-badge)](https://v0.dev/chat/projects/9LbpiNXZJ3s)

## Overview

This repository will stay in sync with your deployed chats on [v0.dev](https://v0.dev).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.dev](https://v0.dev).

## Deployment

Your project is live at:

**[https://vercel.com/worldclasskiosks-projects/v0-kiosk2](https://vercel.com/worldclasskiosks-projects/v0-kiosk2)**

## Build your app

Continue building your app on:

**[https://v0.dev/chat/projects/9LbpiNXZJ3s](https://v0.dev/chat/projects/9LbpiNXZJ3s)**

## How It Works

1. Create and modify your project using [v0.dev](https://v0.dev)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository

## PMS Integration Setup

### 1. Google Sheets 설정

PMS Queue 시트를 자동으로 생성하려면:

\`\`\`bash
npm run setup:pms-queue
\`\`\`

이 명령어는 Google Sheets에 "PMS Queue" 시트를 생성하고 필요한 헤더를 설정합니다.

### 2. 로컬 PMS 연동

로컬 PMS 컴퓨터에서 실행할 Python 스크립트는 `scripts/pms_listener.py`에 있습니다.

자세한 설정 방법은 [PMS Integration Guide](docs/PMS_INTEGRATION.md)를 참고하세요.

### 3. API 엔드포인트

- `GET /api/pms-queue` - 대기 중인 체크인 조회
- `POST /api/pms-queue/complete` - 처리 완료 표시

API 인증은 `Authorization: Bearer YOUR_API_KEY` 헤더를 사용합니다.
