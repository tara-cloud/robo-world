import mqtt, { MqttClient } from 'mqtt';
import { db } from './db';

let client: MqttClient | null = null;

export function getMqtt(): MqttClient {
    if (!client) throw new Error('MQTT not initialised');
    return client;
}

export function initMqtt() {
    const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
    client = mqtt.connect(url, { clientId: 'electro-server' });

    client.on('connect', () => {
        console.log(`[MQTT] connected to ${url}`);
        client!.subscribe('tara/robot/+/heartbeat');
        client!.subscribe('tara/robot/+/sensor');
    });

    client.on('message', async (topic, payload) => {
        const parts    = topic.split('/');  // tara / robot / {id} / {kind}
        const deviceId = parts[2];
        const kind     = parts[3];

        if (!deviceId) return;

        if (kind === 'heartbeat') {
            await db.device.updateMany({
                where: { deviceId },
                data:  { lastSeen: new Date() },
            });
        }

        if (kind === 'sensor') {
            try {
                const body = JSON.parse(payload.toString());
                await db.sensorReading.create({
                    data: {
                        deviceId,
                        temperature: body.temperature,
                        humidity:    body.humidity,
                        light:       body.light,
                        extra:       body,
                    },
                });
            } catch { /* malformed payload */ }
        }
    });

    client.on('error', (err) => console.error('[MQTT] error', err));
}

// Publish a command to a robot topic
export function publishToRobot(
    deviceId: string,
    topic: 'config' | 'display' | 'emotion' | 'speech' | 'ota',
    payload: object,
    qos: 0 | 1 = 0,
) {
    const t = `tara/robot/${deviceId}/${topic}`;
    getMqtt().publish(t, JSON.stringify(payload), { qos });
}
