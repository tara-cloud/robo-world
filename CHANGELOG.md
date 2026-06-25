# Changelog

All notable changes to the Electron project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.1] — 2026-06-25

### Fixed

- `helm/robo-world/templates/deployment.yaml`: mosquitto service changed from
  `ClusterIP` to `NodePort` so ESP32 devices can reach the broker from outside
  the cluster
- `helm/robo-world/values.yaml`: added `mosquitto.nodePort: 30183`

---

## [1.0.0] — 2026-06-17

### Added
- Initial release of Electron — Tara ESP32 Device Framework
- **Firmware** (ESP32 Dev Module)
  - Shared `TaraCore` library: WiFi manager, device registration (HTTP), MQTT connect/reconnect, config manager (NVS)
  - MQTT topics: `config`, `display`, `emotion`, `speech`, `heartbeat`, `sensor`, `ota`
  - OLED boot log with `TARA` logo + scrolling status lines via `tlog()`
  - 8 OLED face templates: idle, happy, sad, thinking, sleeping, listening, speaking, error
  - Blink animation in idle state
  - Emotion engine: maps state + energy to face and robot state
  - Speech stub: shows speaking face for text duration
  - I2C on SDA=21 / SCL=22 (ESP32 Dev Module)
  - Config/WiFi persistence in NVS
  - Device ID derived from MAC address
- **Server** (Fastify + TypeScript + Prisma + PostgreSQL)
  - `POST /device/register` — upsert device
  - `POST /device/heartbeat` — update last-seen
  - `GET/PUT /device/config/:id` — versioned config push/pull
  - `GET /device/config/version/:id` — version check
  - `POST/GET /device/sensor/:id` — sensor readings
  - `GET/POST/PUT /robot/:id` — robot control endpoints
  - MQTT client: subscribes to heartbeat + sensor topics, auto-persists to DB
  - `publishToRobot()` helper for display, emotion, speech, config, OTA commands
- **Dashboard UI** (single-file vanilla HTML/JS, served at `/`)
  - Left sidebar: registered devices with online/offline badge
  - Health card: status, firmware version, last seen, latest sensor reading
  - Display card: 8 face shortcut buttons
  - Speech card: send text to robot
  - Config editor: JSON editor with Push + Format JSON
  - Auto-refreshes device list every 30 s
- **Infrastructure**
  - `docker-compose.yml` with PostgreSQL 16 + Mosquitto 2 + server
  - `mosquitto.conf` minimal broker config
  - ARM64 Docker image: `pmananthu/robo-world`
