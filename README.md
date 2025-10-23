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

---

## Features

### Multi-Property Support

- ✅ **Property1 (C동, D동)** - Overlay button mode
- ✅ **Property2 (Kariv)** - Overlay button mode
- ✅ **Property3 (A동, B동)** - Fullscreen kiosk mode
- ✅ **Property4 (Camp)** - Fullscreen kiosk mode

### Overlay Button System (Property1 & Property2)

- 🔘 Always-on-top button over existing EXE kiosk program
- 🪟 Popup window for reservation check-in
- 🔄 Automatic focus restoration to PMS program after check-in
- ⚡ Seamless integration with legacy systems

### PMS Integration

- ✅ Real-time check-in notifications via Firebase
- ✅ Automatic PMS room status updates via AutoHotkey
- ✅ No API rate limits
- ✅ Free Firebase tier sufficient for small properties
- ✅ **Remote printing from external web apps**

### Hardware Integration

- 🖨️ Receipt printer support (BK3-3, SAM4S)
- 💵 Bill acceptor integration
- 💸 Bill dispenser support
- 🔌 Serial port communication via Electron

---

## Quick Setup

### 1. Environment Variables

Copy `.env.local.template` to `.env.local` and configure:

\`\`\`env
# Property Configuration
KIOSK_PROPERTY=property1  # property1, property2, property3, property4
OVERLAY_MODE=true         # true for Property1/2, false for Property3/4
PMS_WINDOW_TITLE=Property1 PMS

# Firebase & Google Sheets
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_SHEETS_SPREADSHEET_ID=your-sheet-id
# ... see .env.local.template for full list
\`\`\`

### 2. Development Mode

\`\`\`bash
npm install
npm run electron:dev
\`\`\`

**Note**: Audio files are automatically downloaded from Vercel Blob during `npm install`. If you cloned from GitHub and audio files are missing, they will be fetched automatically.

### 3. Production Build

\`\`\`bash
npm run electron:build
\`\`\`

Output: `dist/TheBeachStay Kiosk Setup 1.0.0.exe`

---

## Documentation

- 📘 [Overlay Button System](docs/OVERLAY_BUTTON_SYSTEM.md) - Property1/2 overlay mode
- 🏨 [Property Configuration](docs/PROPERTY_CONFIGURATION.md) - Multi-property setup
- 🚀 [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Production deployment
- 🔧 [Electron Setup](ELECTRON_SETUP.md) - Hardware integration
- 🌐 [Environment Setup](ENV_SETUP_GUIDE.md) - Environment variables
- 🔥 [Firebase Setup](docs/FIREBASE_SETUP.md) - Firebase configuration
- 🖨️ [Remote Printing](docs/REMOTE_PRINTING.md) - Print API documentation

---

## Architecture

### Property1 & Property2 (Overlay Mode)

\`\`\`
┌─────────────────────────────────┐
│  Existing EXE Kiosk Program     │
│  ┌──────────────────┐           │
│  │ Overlay Button   │ ← Electron│
│  └──────────────────┘           │
└─────────────────────────────────┘
         ↓ Click
┌─────────────────────────────────┐
│  Popup Window (Web Kiosk)       │
│  - Reservation Check            │
│  - Check-in Process             │
└─────────────────────────────────┘
         ↓ Complete
┌─────────────────────────────────┐
│  Focus restored to EXE Program  │
└─────────────────────────────────┘
\`\`\`

### Property3 & Property4 (Fullscreen Mode)

\`\`\`
┌─────────────────────────────────┐
│  Fullscreen Kiosk App           │
│  - Idle Screen                  │
│  - Standby Screen               │
│  - Reservation Flow             │
│  - Check-in Complete            │
└─────────────────────────────────┘
\`\`\`

---

## Remote Printing API

Send print jobs to kiosk printers from any external web application.

### Quick Example

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/remote-print \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","password":"1234"}'
\`\`\`

### Features

- 🖨️ Print room number and password remotely
- 🔒 Secure API key authentication
- 🔥 Real-time Firebase synchronization
- 🏨 Automatic property routing
- 🚫 No guest names printed (privacy protection)

---

## Support

For issues or questions:
1. Check documentation in `/docs` folder
2. Review troubleshooting sections
3. Contact development team

---

## License

Private - All rights reserved
