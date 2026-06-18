import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { publishToRobot } from '../mqtt';
import { buildFacesMap } from './face';

export async function robotRoutes(app: FastifyInstance) {
    // GET /robot — list all registered robots with latest health
    app.get('/', async () => {
        return db.device.findMany({
            where:   { deviceType: 'robot' },
            orderBy: { lastSeen: 'desc' },
            include: { readings: { take: 1, orderBy: { recordedAt: 'desc' } } },
        });
    });

    // GET /robot/:deviceId — single robot detail
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId',
        async (req, reply) => {
            const device = await db.device.findUnique({
                where:   { deviceId: req.params.deviceId },
                include: {
                    configs:  { orderBy: { createdAt: 'desc' }, take: 5 },
                    readings: { orderBy: { recordedAt: 'desc' }, take: 20 },
                },
            });
            if (!device) return reply.code(404).send({ error: 'Not found' });
            return device;
        }
    );

    // POST /robot/:deviceId/display — send face name command
    // Device looks up the face in its local cache and renders it.
    app.post<{
        Params: { deviceId: string };
        Body:   { face: string };
    }>('/:deviceId/display', async (req, reply) => {
        const { deviceId } = req.params;
        const { face } = req.body;
        if (!face) return reply.code(400).send({ error: 'face name required' });
        publishToRobot(deviceId, 'display', { face });
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/emotion
    app.post<{
        Params: { deviceId: string };
        Body:   { state: string; energy?: number };
    }>('/:deviceId/emotion', async (req, reply) => {
        publishToRobot(req.params.deviceId, 'emotion', req.body);
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/speech
    app.post<{
        Params: { deviceId: string };
        Body:   { text: string };
    }>('/:deviceId/speech', async (req, reply) => {
        publishToRobot(req.params.deviceId, 'speech', req.body);
        return reply.code(200).send({ ok: true });
    });

    // PUT /robot/:deviceId/config — push config; always injects current faces
    app.put<{
        Params: { deviceId: string };
        Body:   Record<string, unknown>;
    }>('/:deviceId/config', async (req, reply) => {
        const { deviceId } = req.params;
        const faces = await buildFacesMap();

        const last = await db.deviceConfig.findFirst({
            where:   { deviceId },
            orderBy: { createdAt: 'desc' },
        });
        const version = String((parseInt(last?.version ?? '0') + 1));

        const configWithFaces = { ...req.body, faces, version };

        await db.deviceConfig.create({
            data: { deviceId, version, config: configWithFaces },
        });

        publishToRobot(deviceId, 'config', configWithFaces, 1);
        return reply.code(201).send({ version });
    });

    // POST /robot/:deviceId/actuator — send a value to an output pin
    app.post<{
        Params: { deviceId: string };
        Body:   { pin: string; value: unknown };
    }>('/:deviceId/actuator', async (req, reply) => {
        const { deviceId } = req.params;
        const { pin, value } = req.body;
        publishToRobot(deviceId, 'actuator', { pin, value });
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/ota/broadcast?deviceType=robot — push OTA to all devices of a type
    // Called by Pocket when an OTA release is pushed
    app.post<{
        Querystring: { deviceType?: string };
        Body:        { version: string; url: string };
    }>('/ota/broadcast', async (req, reply) => {
        const deviceType = req.query.deviceType ?? 'robot';
        const { version, url } = req.body;

        if (!version || !url) return reply.code(400).send({ error: 'version and url required' });

        // Find all registered devices of this type
        const devices = await db.device.findMany({
            where: { deviceType },
            select: { deviceId: true },
        });

        for (const d of devices) {
            publishToRobot(d.deviceId, 'ota', { version, url }, 1);
        }

        return reply.code(200).send({ pushed: devices.length, version, url });
    });

    // GET /robot/:deviceId/ota-check — compare device firmware version against latest in Pocket
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/ota-check',
        async (req, reply) => {
            const device = await db.device.findUnique({ where: { deviceId: req.params.deviceId } });
            if (!device) return reply.code(404).send({ error: 'device not found' });

            const pocketUrl = process.env.POCKET_URL ?? 'http://192.168.0.107:30600';

            // Ask Pocket for the latest OTA release for this device type
            type OTARelease = { id: number; version: string; releaseNotes: string; artifact: { name: string } };
            let releases: OTARelease[] = [];
            try {
                const res = await fetch(`${pocketUrl}/api/ota`);
                if (res.ok) releases = (await res.json()) as OTARelease[];
            } catch {
                return reply.code(502).send({ error: 'Cannot reach Pocket' });
            }

            // Find the latest release matching this device type
            const matching = releases
                .filter(r => r.artifact?.name?.includes(device.deviceType) ||
                             device.deviceType === 'robot')
                .sort((a, b) => b.id - a.id);

            if (!matching.length) {
                return reply.send({ available: false, currentVersion: device.firmwareVersion });
            }

            const latest = matching[0];
            const available = latest.version !== device.firmwareVersion;
            return reply.send({
                available,
                currentVersion:  device.firmwareVersion,
                latestVersion:   latest.version,
                releaseNotes:    latest.releaseNotes,
                otaReleaseId:    latest.id,
            });
        }
    );

    // POST /robot/:deviceId/push-ota — trigger OTA push for a specific device via Pocket release
    app.post<{
        Params: { deviceId: string };
        Body:   { otaReleaseId: number };
    }>('/:deviceId/push-ota', async (req, reply) => {
        const { otaReleaseId } = req.body;

        const pocketUrl   = process.env.POCKET_URL  ?? 'http://192.168.0.107:30600';
        const pocketToken = process.env.POCKET_TOKEN ?? '';

        const res = await fetch(`${pocketUrl}/api/ota/${otaReleaseId}/push`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(pocketToken ? { 'X-Pocket-Token': pocketToken } : {}),
            },
            body: '{}',
        }).catch(() => null);

        if (res?.ok !== true) {
            return reply.code(502).send({ error: 'Pocket OTA push failed' });
        }

        return reply.code(200).send({ ok: true });
    });
}
