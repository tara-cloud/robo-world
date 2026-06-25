import mqtt, { MqttClient } from 'mqtt';
import { db } from './db';

let client: MqttClient | null = null;

// Live pin state cache: deviceId → { label → value }
export const pinStateCache: Record<string, Record<string, unknown>> = {};

export function getMqtt(): MqttClient {
    if (!client) throw new Error('MQTT not initialised');
    return client;
}

export function initMqtt() {
    const url = process.env.MQTT_URL
        ?? (process.env.MQTT_HOST ? `mqtt://${process.env.MQTT_HOST}:1883` : 'mqtt://localhost:1883');
    client = mqtt.connect(url, { clientId: 'robo-world' });

    client.on('connect', () => {
        console.log(`[MQTT] connected to ${url}`);
        client!.subscribe('tara/robot/+/heartbeat');
        client!.subscribe('tara/robot/+/sensor');
        client!.subscribe('tara/robot/+/pin_state');
        client!.subscribe('+/+/logs');   // {projectId}/{deviceName}/logs
        client!.subscribe('+');          // dotted: {projectId}.{deviceName}.healthcheck
    });

    client.on('message', async (topic, payload) => {
        // {projectId}.{deviceName}.healthcheck (dot-separated, single MQTT level)
        if (topic.endsWith('.healthcheck')) {
            await handleHealthMessage(topic, payload.toString());
            return;
        }

        // {projectId}/{deviceName}/logs
        if (topic.endsWith('/logs')) {
            await handleLogMessage(topic, payload.toString());
            return;
        }

        const parts    = topic.split('/'); // tara/robot/{id}/{kind}
        const deviceId = parts[2];
        const kind     = parts[3];
        if (!deviceId) return;

        await handleMessage(deviceId, kind, payload.toString());
    });

    client.on('error', (err) => console.error('[MQTT] error', err));
}

async function handleLogMessage(topic: string, raw: string) {
    try {
        const body = JSON.parse(raw);
        const parts           = topic.split('/');   // {projectId}/{deviceName}/logs
        const projectId       = parts[0] || (body.projectID       as string);
        const deviceName      = parts[1] || (body.deviceName      as string);
        const level           = (body.level           as string) || 'INFO';
        const logger          = (body.logger          as string) || topic;
        const message         = (body.message         as string) || raw;
        const firmwareVersion = (body.firmwareVersion as string) || '';

        if (!projectId || !deviceName) return;

        await db.deviceLog.create({
            data: { projectId, deviceName, level, logger, message, firmwareVersion },
        });

        // Keep max 500 logs per project — delete oldest beyond that
        const count = await db.deviceLog.count({ where: { projectId } });
        if (count > 500) {
            const oldest = await db.deviceLog.findMany({
                where:   { projectId },
                orderBy: { createdAt: 'asc' },
                take:    count - 500,
                select:  { id: true },
            });
            await db.deviceLog.deleteMany({ where: { id: { in: oldest.map(l => l.id) } } });
        }
    } catch { /* malformed payload */ }
}

async function handleHealthMessage(topic: string, raw: string) {
    try {
        const body  = JSON.parse(raw);
        const parts = topic.split('.');   // {projectId}.{deviceName}.healthcheck
        const projectId       = parts[0] || (body.projectId       as string);
        const deviceName      = parts[1] || (body.deviceName      as string);
        const firmwareVersion = (body.firmwareVersion as string) || '';
        const status          = (body.status          as string) || 'Online';
        const components      = body.components ?? [];
        const timestamp       = (body.timestamp       as string) || '';

        if (!projectId || !deviceName) return;

        await db.deviceHealth.create({
            data: { projectId, deviceName, firmwareVersion, status, components, timestamp },
        });

        // Health-check doubles as a liveness signal — refresh Device.lastSeen
        // (this firmware doesn't send the legacy tara/robot/+/heartbeat topic)
        await db.device.updateMany({
            where: { deviceName },
            data:  {
                lastSeen: new Date(),
                ...(firmwareVersion ? { firmwareVersion } : {}),
            },
        }).catch(() => { /* device may not be registered yet */ });
    } catch { /* malformed payload */ }
}

async function handleMessage(deviceId: string, kind: string, raw: string) {
    if (kind === 'heartbeat') {
        try {
            const hb   = JSON.parse(raw);
            const data: Record<string, unknown> = { lastSeen: new Date() };
            if (hb.ip) data['ipAddress'] = hb.ip;
            await db.device.updateMany({ where: { deviceId }, data });
        } catch {
            await db.device.updateMany({ where: { deviceId }, data: { lastSeen: new Date() } }).catch(() => {});
        }
        return;
    }

    if (kind === 'sensor') {
        try {
            const body = JSON.parse(raw);
            await db.sensorReading.create({
                data: {
                    deviceId,
                    temperature: body.temperature,
                    humidity:    body.humidity,
                    light:       body.light,
                    extra:       body,
                },
            });
            await runPipeline(deviceId, body);
        } catch { /* malformed payload */ }
        return;
    }

    if (kind === 'pin_state') {
        try {
            const state = JSON.parse(raw);
            pinStateCache[deviceId] = Object.assign(pinStateCache[deviceId] ?? {}, state);
        } catch { /* malformed */ }
    }
}

// ── Pipeline engine ───────────────────────────────────────────────────────────

function evalThreshold(val: number, operator: string, thresh: number): boolean {
    if (operator === '>')  return val >  thresh;
    if (operator === '<')  return val <  thresh;
    if (operator === '>=') return val >= thresh;
    if (operator === '<=') return val <= thresh;
    if (operator === '==') return val === thresh;
    return false;
}

function fireThreshold(cfg: Record<string, unknown>, deviceId: string, reading: Record<string, unknown>) {
    const field    = cfg['field']    as string;
    const operator = cfg['operator'] as string;
    const thresh   = cfg['value']    as number;
    const val      = reading[field]  as number;
    if (val == null || !evalThreshold(val, operator, thresh)) return;

    const mqttTopic   = cfg['mqttTopic']   as string | undefined;
    const mqttPayload = cfg['mqttPayload'] as object | undefined;
    if (mqttTopic && mqttPayload) {
        getMqtt().publish(mqttTopic, JSON.stringify(mqttPayload), { qos: 0 });
        console.log(`[Pipeline] threshold ${field}${operator}${thresh} → ${mqttTopic}`);
    }
}

async function runRule(
    rule: { id: string; action: string; pinLabel: string; config: unknown },
    deviceId: string,
    reading: Record<string, unknown>,
) {
    const cfg = rule.config as Record<string, unknown>;

    if (rule.action === 'log')            return;
    if (rule.action === 'threshold')      { fireThreshold(cfg, deviceId, reading); return; }
    if (rule.action === 'mqtt_publish')   {
        const t = cfg['topic'] as string;
        if (t) getMqtt().publish(t, JSON.stringify(reading), { qos: 0 });
        return;
    }
    if (rule.action === 'actuator') {
        const pin = cfg['pinLabel'] as string;
        if (pin) getMqtt().publish(
            `tara/robot/${deviceId}/actuator`,
            JSON.stringify({ pin, value: cfg['value'] }),
            { qos: 0 },
        );
    }
}

async function runPipeline(deviceId: string, reading: Record<string, unknown>) {
    const rules = await db.pipelineRule.findMany({ where: { deviceId, enabled: true } });
    for (const rule of rules) {
        await runRule(rule, deviceId, reading).catch(e =>
            console.error(`[Pipeline] rule ${rule.id} error:`, e)
        );
    }
}

// ── Publish helpers ───────────────────────────────────────────────────────────

export function publishToRobot(
    deviceId: string,
    topic: 'config' | 'display' | 'emotion' | 'speech' | 'ota' | 'actuator',
    payload: object,
    qos: 0 | 1 = 0,
) {
    getMqtt().publish(`tara/robot/${deviceId}/${topic}`, JSON.stringify(payload), { qos });
}
