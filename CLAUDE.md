# Robo World — Tara Device Management Server

## Overview

Fastify + Prisma server for managing Tara robot ESP32 devices.
Handles registration (with dynamic component discovery), config push,
OTA, sensor readings, and MQTT bridging.

> **Firmware lives in a separate repo:**
> [tara-cloud/tara-robo](https://github.com/tara-cloud/tara-robo) — PlatformIO ESP32 firmware

## Repository Structure

```text
robo-world/
└── server/                 # Fastify + Prisma device management API
    ├── src/
    │   ├── index.ts
    │   ├── db.ts
    │   ├── mqtt.ts
    │   └── routes/
    │       ├── device.ts   # register (with components), heartbeat
    │       ├── hardware.ts # components, pins, pipeline rules
    │       ├── config.ts   # version check, download, push
    │       └── sensor.ts   # sensor readings
    └── prisma/
        └── schema.prisma
```

## Server

### Running Locally

```bash
cd server
npm install
npm run dev
```

### API Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/device/register` | Register device + upsert discovered components |
| POST | `/device/heartbeat` | Update last-seen |
| GET | `/robot/:deviceId/components` | Components with nested pins |
| GET | `/robot/:deviceId/pins` | Flat pin list with component info |
| GET | `/device/config/version/:deviceId` | Latest config version |
| GET | `/device/config/:deviceId` | Download config JSON |
| PUT | `/device/config/:deviceId` | Push new config version |
| POST | `/device/sensor/:deviceId` | Submit sensor reading |
| GET | `/device/sensor/:deviceId` | Query readings |
| GET | `/health` | Health check |

## Deployment

```bash
# Build and push server image (ARM64)
docker buildx build --platform linux/arm64 \
  -t pmananthu/robo-world:VERSION --push server/

# Helm install on Pi (namespace: robo-world, port: 30400)
cd helm && tar czf /tmp/robo-world-chart.tar.gz robo-world/
sshpass -p "..." scp /tmp/robo-world-chart.tar.gz pi@192.168.0.107:/tmp/
```

## Environment Variables (server)

```text
DATABASE_URL=postgresql://robo_user:<DB_PASSWORD>@postgres:5432/robo_world
PORT=4000
MQTT_URL=mqtt://<host>:1883
```
