# Changelog

All notable changes to the Electron project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.1.4] — 2026-06-26

### Fixed

- `release.yml`: removed `--reuse-values` from `helm upgrade --install` —
  causes "may not be specified when value is not empty" error on fresh install
  because there are no prior release values to reuse; chart defaults are
  sufficient

---

## [1.1.3] — 2026-06-25

### Fixed

- `release.yml`: extend namespace adoption step to label and annotate all
  existing resources (deployments, services, configmaps, secrets, pvcs) so
  Helm can import them — fixes "invalid ownership metadata" on all resource
  types, not just the namespace

---

## [1.1.2] — 2026-06-25

### Fixed

- `release.yml`: add "Adopt namespace for Helm" step before `helm upgrade`
  — labels and annotates the existing `robo-world` namespace so Helm can
  manage it (fixes "invalid ownership metadata" error on first CI deploy)

---

## [1.1.1] — 2026-06-25

### Fixed

- `release.yml`: add `--install` and `--create-namespace` to `helm upgrade`
  so it works on first deploy when no prior Helm release exists
  (was failing with "has no deployed releases")

---

## [1.1.0] — 2026-06-25

### Added

- Delete project button in the project Details view (next to Edit)
- `deleteProject()` function in dashboard UI — confirms, calls
  `DELETE /projects/:id`, shows toast, navigates home on success
  (backend endpoint already existed: unassigns devices, cascades services)

---

## [1.0.1] — 2026-06-25

### Fixed

- `helm/deployment.yaml`: mosquitto service changed from `ClusterIP` to
  `NodePort 30183` so ESP32 devices can reach the broker from outside the cluster
- `server/src/mqtt.ts`: fall back to `MQTT_HOST` env var when `MQTT_URL` is
  not set — fixes `ECONNREFUSED` when pod is deployed with `MQTT_HOST` only

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
