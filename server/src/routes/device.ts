import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { getMqtt } from '../mqtt';

interface ComponentPin {
    pin: string;
    label: string;
    direction: string;
}

interface ComponentInfo {
    name: string;
    type: string;
    protocol?: string;
    address?: string;
    pins: ComponentPin[];
}

export async function deviceRoutes(app: FastifyInstance) {
    // POST /device/register
    app.post<{ Body: {
        deviceId: string;
        deviceName: string;
        deviceType: string;
        firmwareVersion: string;
        ip?: string;
        projectId?: string;
        components?: ComponentInfo[];
    } }>('/register', async (req, reply) => {
        const { deviceId, deviceName, deviceType, firmwareVersion, ip, projectId, components } = req.body;

        // Resolve projectId slug → internal id; ignore if not found
        let validProjectId: string | undefined;
        if (projectId) {
            const project = await db.project.findUnique({ where: { projectId } });
            validProjectId = project?.id;
        }

        const device = await db.device.upsert({
            where:  { deviceId },
            update: {
                deviceName, deviceType, firmwareVersion, lastSeen: new Date(),
                ...(ip             ? { ipAddress: ip }          : {}),
                ...(validProjectId ? { projectId: validProjectId } : {}),
            },
            create: {
                deviceId, deviceName, deviceType, firmwareVersion,
                ...(ip             ? { ipAddress: ip }          : {}),
                ...(validProjectId ? { projectId: validProjectId } : {}),
            },
        });

        if (components && components.length > 0) {
            for (const c of components) {
                const comp = await db.deviceComponent.upsert({
                    where:  { deviceId_name: { deviceId, name: c.name } },
                    update: { type: c.type, protocol: c.protocol ?? null, address: c.address ?? null },
                    create: { deviceId, name: c.name, type: c.type, protocol: c.protocol ?? null, address: c.address ?? null },
                });

                await Promise.all(c.pins.map(p =>
                    db.devicePin.upsert({
                        where:  { deviceId_pin: { deviceId, pin: p.pin } },
                        update: { componentId: comp.id, label: p.label, direction: p.direction },
                        create: { componentId: comp.id, deviceId, pin: p.pin, label: p.label, direction: p.direction },
                    })
                ));
            }
        }

        const deviceWithProject = await db.device.findUnique({
            where:   { deviceId },
            include: { project: true },
        });

        const slug = deviceWithProject?.project?.projectId ?? null;

        // Create default config on first registration; re-push latest on restart
        if (deviceWithProject?.project) {
            const proj = deviceWithProject.project;

            const existingConfig = await db.deviceConfig.findFirst({
                where:   { deviceId },
                orderBy: { createdAt: 'desc' },
            });

            let configToSend: Record<string, unknown>;

            if (!existingConfig) {
                // First registration — create and persist default config
                configToSend = {
                    deviceName,
                    deviceType,
                    mqttHost:    proj.mqttHost || '',
                    mqttPort:    proj.mqttPort,
                    healthcheck: { enabled: false, frequency: 60 },
                };
                await db.deviceConfig.create({
                    data: { deviceId, version: '1', config: configToSend as object },
                });
            } else {
                // Re-registration — use latest saved config
                configToSend = existingConfig.config as Record<string, unknown>;
            }

            // Small delay — gives device time to subscribe to its config topic
            // before the retained message is delivered
            await new Promise(r => setTimeout(r, 500));

            // Publish retained so device receives it even if it subscribes after this
            // Topic suffix is fixed to `.config` — config4h subscribes to `{projectId}.{deviceName}.config`
            const topic = `${proj.projectId}.${deviceName}.config`;
            const payload = JSON.stringify({
                ...configToSend,
                projectID:   proj.projectId,
                projectName: proj.name,
            });
            try {
                getMqtt().publish(topic, payload, { qos: 1, retain: true });
            } catch { /* MQTT not ready — device will receive on next retained delivery */ }
        }

        return reply.code(200).send({ id: device.id, deviceId: device.deviceId, projectId: slug });
    });

    // POST /device/heartbeat
    app.post<{ Body: {
        deviceId: string;
        ip?: string;
        firmwareVersion?: string;
        status?: string;
    } }>('/heartbeat', async (req, reply) => {
        const { deviceId, ip, firmwareVersion } = req.body;

        await db.device.update({
            where: { deviceId },
            data: {
                lastSeen: new Date(),
                ...(firmwareVersion ? { firmwareVersion } : {}),
                ...(ip             ? { ipAddress: ip }   : {}),
            },
        });

        return reply.code(200).send({ ok: true });
    });

    // GET /device/mqtt-config/:deviceId
    // Called by firmware after registration — returns project MQTT config
    app.get<{ Params: { deviceId: string } }>('/mqtt-config/:deviceId', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device) return reply.code(404).send({ error: 'device not found' });
        if (!device.project) return reply.code(404).send({ error: 'device not assigned to a project' });

        const { mqttHost, mqttPort, otaTopic, configTopic } = device.project;
        return reply.code(200).send({ mqttHost, mqttPort, otaTopic, configTopic });
    });
}
