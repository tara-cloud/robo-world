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

        // Push config to device via MQTT immediately after registration
        if (deviceWithProject?.project) {
            const proj = deviceWithProject.project;
            const configTopic = `${proj.projectId}.${deviceName}.${proj.configTopic}`;
            const configPayload = JSON.stringify({
                projectID:   proj.projectId,
                projectName: proj.name,
                deviceName,
                deviceType,
                mqttHost:    proj.mqttHost,
                mqttPort:    proj.mqttPort,
            });
            try {
                getMqtt().publish(configTopic, configPayload, { qos: 1, retain: true });
            } catch { /* MQTT may not be ready — device will get it on next connect */ }
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
