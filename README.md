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

### Documentation

- [Quick Start Guide](docs/QUICK_START.md) - Get started in 15 minutes
- [Firebase Setup](docs/FIREBASE_SETUP.md) - Detailed Firebase configuration
- [PMS Integration](docs/PMS_INTEGRATION.md) - Architecture and troubleshooting
