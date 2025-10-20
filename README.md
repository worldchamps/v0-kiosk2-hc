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

## PMS Integration

This kiosk integrates with local PMS (Property Management System) software using Firebase Realtime Database for real-time check-in automation.

### Quick Setup

1. **Firebase Setup** (5 minutes)
   - Create Firebase project with Realtime Database
   - Download service account key
   - See [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md)

2. **Environment Variables**
   - Add Firebase credentials to Vercel (Vars section in v0)
   - See [.env.example](.env.example)

3. **Local PMS Listener**
   - Install Python and Firebase Admin SDK
   - Run `python scripts/pms_firebase_listener.py`
   - See [docs/QUICK_START.md](docs/QUICK_START.md)

### Features

- ✅ Real-time check-in notifications (no polling)
- ✅ Automatic PMS room status updates via AutoHotkey
- ✅ No API rate limits
- ✅ Free Firebase tier sufficient for small properties
- ✅ **Remote printing from external web apps**
- ✅ **Room status sync with BeachRoomStatus spreadsheet**

### Documentation

- [Quick Start Guide](docs/QUICK_START.md) - Get started in 15 minutes
- [Firebase Setup](docs/FIREBASE_SETUP.md) - Detailed Firebase configuration
- [PMS Integration](docs/PMS_INTEGRATION.md) - Architecture and troubleshooting
- [Remote Printing](docs/REMOTE_PRINTING.md) - Print room info from other apps
- [Room Status Sync](docs/ROOM_STATUS_SYNC.md) - Sync room status with BeachRoomStatus

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
- 🏨 Automatic property routing (A/B → property3, CAMP → property4)
- 🚫 No guest names printed (privacy protection)

See [docs/REMOTE_PRINTING.md](docs/REMOTE_PRINTING.md) for complete documentation.

---

## Room Status Update API

Update room status in BeachRoomStatus spreadsheet from your PMS web app.

### Quick Example

\`\`\`bash
curl -X POST https://your-kiosk-app.vercel.app/api/room-status/update \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"roomNumber":"A101","status":"occupied"}'
\`\`\`

### Features

- 📊 Update BeachRoomStatus spreadsheet in real-time
- 🔄 Sync room status: vacant, occupied, cleaning, maintenance
- 🔒 Secure API key authentication
- 🏨 Works with all properties (A/B/CAMP rooms)
- ✅ Automatic row detection and update

### Use Cases

- **Check-in**: Update status to "occupied"
- **Check-out**: Update status to "cleaning"
- **Cleaning complete**: Update status to "vacant"
- **Maintenance**: Update status to "maintenance"

See [docs/ROOM_STATUS_SYNC.md](docs/ROOM_STATUS_SYNC.md) for complete documentation.
