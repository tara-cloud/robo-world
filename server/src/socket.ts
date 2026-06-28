import net from 'net';
import { db } from './db';

// Connected devices: deviceId → socket
const clients = new Map<string, net.Socket>();

export function getSocketClient(deviceId: string): net.Socket | undefined {
    return clients.get(deviceId);
}

export function pushToDevice(deviceId: string, payload: object): boolean {
    const sock = clients.get(deviceId);
    if (!sock || sock.destroyed) return false;
    sock.write(JSON.stringify(payload) + '\n');
    return true;
}

async function handleMessage(sock: net.Socket, raw: string) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }

    const type     = msg['type'] as string;
    const deviceId = msg['deviceId'] as string | undefined;

    if (type === 'register') {
        if (!deviceId) return;
        clients.set(deviceId, sock);
        (sock as any)._deviceId = deviceId;
        console.log(`[socket] registered: ${deviceId}`);

        // Upsert device
        const { deviceName, deviceType, firmwareVersion, ip, projectId, components } = msg as any;

        let validProjectId: string | undefined;
        if (projectId) {
            const proj = await db.project.findUnique({ where: { projectId } });
            validProjectId = proj?.id;
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

        // Upsert components
        if (Array.isArray(components)) {
            for (const c of components) {
                const comp = await db.deviceComponent.upsert({
                    where:  { deviceId_name: { deviceId, name: c.name } },
                    update: { type: c.type, protocol: c.protocol ?? null, address: c.address ?? null },
                    create: { deviceId, name: c.name, type: c.type, protocol: c.protocol ?? null, address: c.address ?? null },
                });
                for (const p of (c.pins ?? [])) {
                    await db.devicePin.upsert({
                        where:  { deviceId_pin: { deviceId, pin: p.pin } },
                        update: { componentId: comp.id, label: p.label, direction: p.direction },
                        create: { componentId: comp.id, deviceId, pin: p.pin, label: p.label, direction: p.direction },
                    });
                }
            }
        }

        // Push config back
        const deviceWithProject = await db.device.findUnique({
            where:   { deviceId },
            include: { project: true },
        });

        if (deviceWithProject?.project) {
            const proj = deviceWithProject.project;
            const existingConfig = await db.deviceConfig.findFirst({
                where:   { deviceId },
                orderBy: { createdAt: 'desc' },
            });

            let configToSend: Record<string, unknown>;
            if (!existingConfig) {
                configToSend = {
                    deviceName,
                    deviceType,
                    healthcheck: { enabled: true, frequency: 60 },
                };
                await db.deviceConfig.create({
                    data: { deviceId, version: '1', config: configToSend as object },
                });
            } else {
                configToSend = existingConfig.config as Record<string, unknown>;
            }

            pushToDevice(deviceId, {
                type:        'config',
                projectId:   proj.projectId,
                projectName: proj.name,
                ...configToSend,
            });
        }
        return;
    }

    if (type === 'heartbeat' && deviceId) {
        await db.device.updateMany({
            where: { deviceId },
            data:  { lastSeen: new Date(), ...(msg['ip'] ? { ipAddress: msg['ip'] as string } : {}) },
        }).catch(() => {});
        return;
    }

    if (type === 'health' && deviceId) {
        const { status, firmwareVersion } = msg as any;
        const dev = await db.device.findUnique({ where: { deviceId }, select: { deviceName: true, projectId: true, project: true } });
        if (dev) {
            await db.deviceHealth.create({
                data: {
                    projectId:       dev.project?.projectId ?? '',
                    deviceName:      dev.deviceName,
                    firmwareVersion: firmwareVersion ?? '',
                    status:          status ?? 'online',
                    components:      [],
                    timestamp:       new Date().toISOString(),
                },
            }).catch(() => {});
            await db.device.updateMany({
                where: { deviceId },
                data:  { lastSeen: new Date(), ...(firmwareVersion ? { firmwareVersion } : {}) },
            }).catch(() => {});
        }
        return;
    }

    if (type === 'log' && deviceId) {
        const { level, message, logger, firmwareVersion } = msg as any;
        const dev = await db.device.findUnique({ where: { deviceId }, select: { deviceName: true, project: true } });
        if (dev) {
            await db.deviceLog.create({
                data: {
                    projectId:       dev.project?.projectId ?? '',
                    deviceName:      dev.deviceName,
                    level:           level   ?? 'INFO',
                    logger:          logger  ?? 'device',
                    message:         message ?? '',
                    firmwareVersion: firmwareVersion ?? '',
                },
            }).catch(() => {});
        }
        return;
    }

    if (type === 'sensor' && deviceId) {
        const { temperature, humidity, light } = msg as any;
        await db.sensorReading.create({
            data: { deviceId, temperature, humidity, light, extra: msg as object },
        }).catch(() => {});
        return;
    }
}

export function initSocket() {
    const port = parseInt(process.env.SOCKET_PORT ?? '3001');

    const server = net.createServer((sock) => {
        let buf = '';
        console.log(`[socket] client connected: ${sock.remoteAddress}`);

        sock.on('data', (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) handleMessage(sock, trimmed);
            }
        });

        sock.on('close', () => {
            const id = (sock as any)._deviceId as string | undefined;
            if (id) {
                clients.delete(id);
                console.log(`[socket] disconnected: ${id}`);
            }
        });

        sock.on('error', (err) => {
            console.error('[socket] error:', err.message);
        });
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[socket] TCP server listening on port ${port}`);
    });
}
