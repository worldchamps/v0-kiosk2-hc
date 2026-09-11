/**
 * Hardware Server Bridge
 * Connects to the local Python hardware server via WebSocket
 */

const WebSocket = require('ws'); // Node.js environment requires 'ws' package

let ws = null
let reconnectTimer = null
let onMessageCallback = null
let onStatusCallback = null
const messageListeners = new Set()

function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return

    console.log("[HARDWARE_BRIDGE] Connecting to ws://localhost:8082...")

    try {
        // Standard WebSocket initialization using 'ws'
        ws = new WebSocket("ws://localhost:8082")

        ws.on('open', () => {
            console.log("[HARDWARE_BRIDGE] Connected to hardware server")
            if (reconnectTimer) {
                clearInterval(reconnectTimer)
                reconnectTimer = null
            }
            if (onStatusCallback) onStatusCallback({ connected: true })
        })

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString())
                for (const listener of messageListeners) listener(message)
                if (onMessageCallback) onMessageCallback(message)
            } catch (e) {
                console.error("[HARDWARE_BRIDGE] Error parsing message:", e)
            }
        })

        ws.on('close', (code, reason) => {
            console.log(`[HARDWARE_BRIDGE] Connection closed (Code: ${code}, Reason: ${reason})`)
            if (onStatusCallback) onStatusCallback({ connected: false })
            startReconnecting()
        })

        ws.on('error', (error) => {
            console.error("[HARDWARE_BRIDGE] WebSocket error:", error.message)
            // Error will trigger close, so reconnection is handled there
        })
    } catch (e) {
        console.error("[HARDWARE_BRIDGE] Failed to create WebSocket:", e)
        startReconnecting()
    }
}

function startReconnecting() {
    if (reconnectTimer) return
    reconnectTimer = setInterval(connect, 5000)
}

function send(message) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message))
        return true
    }
    return false
}

module.exports = {
    connect,
    send,
    onMessage: (cb) => { onMessageCallback = cb },
    subscribeMessage: (cb) => { messageListeners.add(cb); return () => messageListeners.delete(cb) },
    onStatus: (cb) => { onStatusCallback = cb },
    get isConnected() { return ws && ws.readyState === 1 },
    retryConnection: () => {
        if (ws) {
            try { ws.close() } catch (e) { }
            ws = null
        }
        connect()
    }
}
