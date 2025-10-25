# Serial Port Configuration Guide

## Overview

This guide explains the serial port configuration for external devices connected to the kiosk system.

## Device Configuration

### 1. Printer (Receipt Printer)
- **Port**: COM2
- **Baud Rate**: 115200 bps (manufacturer recommended)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

**Why 115200 bps?**
- Manufacturer specification for optimal performance
- Fast data transfer for receipt printing
- Supported by modern BIXOLON printers

### 2. Bill Acceptor (지폐 인식기)
- **Port**: COM4
- **Baud Rate**: 9600 bps (manufacturer specification)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

**Manufacturer Specification:**
According to ONEPLUS Bill Acceptor manual, the device requires:
- Fixed baud rate: 9600 bps
- Cannot be changed (hardware limitation)

### 3. Bill Dispenser (지폐 방출기)
- **Port**: COM5
- **Baud Rate**: 9600 bps
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

## Configuration Methods

### Method 1: Environment Variables (Recommended)

Edit `.env.local` file:

\`\`\`bash
# Printer Configuration
PRINTER_PATH=COM2
PRINTER_BAUD_RATE=115200
PRINTER_DATA_BITS=8
PRINTER_STOP_BITS=1
PRINTER_PARITY=none

# Bill Acceptor Configuration
BILL_ACCEPTOR_PATH=COM4
BILL_ACCEPTOR_BAUD_RATE=9600
BILL_ACCEPTOR_DATA_BITS=8
BILL_ACCEPTOR_STOP_BITS=1
BILL_ACCEPTOR_PARITY=none

# Bill Dispenser Configuration
BILL_DISPENSER_PATH=COM5
BILL_DISPENSER_BAUD_RATE=9600
BILL_DISPENSER_DATA_BITS=8
BILL_DISPENSER_STOP_BITS=1
BILL_DISPENSER_PARITY=none
\`\`\`

### Method 2: Code Configuration

The configuration is loaded in `electron/main.js`:

\`\`\`javascript
const PRINTER_CONFIG = {
  path: process.env.PRINTER_PATH || "COM2",
  baudRate: Number.parseInt(process.env.PRINTER_BAUD_RATE) || 115200,
  dataBits: Number.parseInt(process.env.PRINTER_DATA_BITS) || 8,
  stopBits: Number.parseInt(process.env.PRINTER_STOP_BITS) || 1,
  parity: process.env.PRINTER_PARITY || "none",
}
\`\`\`

## Baud Rate Impact Analysis

### 9600 bps (Recommended)
- **Transfer Speed**: ~960 bytes/second
- **Stability**: ✅ Very high (resistant to cable noise)
- **Compatibility**: ✅ Supported by all devices
- **Error Rate**: ✅ Very low
- **Cable Length**: ✅ Works with cables up to 15 meters

### 115200 bps (Recommended)
- **Transfer Speed**: ~11,520 bytes/second
- **Stability**: ⚠️ Requires high-quality short cables
- **Compatibility**: ⚠️ May not be supported by older devices
- **Error Rate**: ⚠️ Higher with poor cable quality
- **Cable Length**: ⚠️ Limited to 1-2 meters for stability

## Troubleshooting

### Connection Failed
1. Verify the COM port number in Device Manager
2. Check if another application is using the port
3. Ensure the device is powered on
4. Try reconnecting the USB-to-Serial adapter

### Intermittent Communication Errors
1. Check cable quality and length
2. Verify baud rate matches device specification
3. Ensure proper grounding
4. Check for electromagnetic interference

### Device Not Responding
1. Verify power supply (12V or 24V DC)
2. Check serial cable pinout (Rx, Tx, GND)
3. Confirm baud rate setting
4. Try hardware reset

## Best Practices

1. **Always use manufacturer-recommended baud rates**
   - Printer: 115200 bps (BIXOLON SDK)
   - Bill Acceptor: 9600 bps (ONEPLUS specification)
   - Bill Dispenser: 9600 bps

2. **Use high-quality serial cables**
   - Shielded cables for noisy environments
   - Keep cable length under 5 meters when possible

3. **Implement proper error handling**
   - Retry failed commands (up to 3 times)
   - Log communication errors
   - Auto-reconnect on connection loss

4. **Test in production environment**
   - Verify stability over extended periods
   - Monitor error rates
   - Check performance under load

## References

- BIXOLON Windows POS SDK API Reference Guide v2.10
- ONEPLUS Bill Acceptor RS-232 Communication Protocol
- Node.js SerialPort Documentation: https://serialport.io/
