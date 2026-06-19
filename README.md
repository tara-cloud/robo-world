# Electron

ESP32 device firmware + management server for the Tara robot ecosystem.

## Projects

| Component | Description |
|-----------|-------------|
| `firmware/` | PlatformIO firmware for ESP32 Dev Module — WiFi, MQTT, OLED display |
| `server/` | Fastify + Prisma API server — device registry, config push, sensor storage |
| `server/public/` | Dashboard UI — device health, OLED control, config editor |

## Quick Start

### Flash firmware
```bash
cd firmware
pio run -e robot -t upload   # flashes to /dev/cu.usbserial-0001
```

### Run server locally
```bash
cd server
npm install
npm run dev      # http://localhost:4000
```

### Deploy on Pi
```bash
docker compose up -d
```

## Versioning
See [CHANGELOG.md](CHANGELOG.md) and [VERSION](VERSION).
