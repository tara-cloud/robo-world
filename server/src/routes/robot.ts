import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { pushToDevice } from '../socket';
import { buildFacesMap } from './face';
import { getSetting } from './settings';

export async function robotRoutes(app: FastifyInstance) {
    // GET /robot — list all registered robots with latest health
    app.get('/', async () => {
        return db.device.findMany({
            where:   { deviceType: 'tara-robo' },
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
                    project:  true,
                },
            });
            if (!device) return reply.code(404).send({ error: 'Not found' });
            return device;
        }
    );

    // GET /robot/:deviceId/health/latest
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/health/latest',
        async (req, reply) => {
            const device = await db.device.findUnique({
                where:   { deviceId: req.params.deviceId },
                include: { project: true },
            });
            if (!device || !device.project) return reply.send(null);

            const latest = await db.deviceHealth.findFirst({
                where:   { projectId: device.project.projectId, deviceName: device.deviceName },
                orderBy: { createdAt: 'desc' },
            });
            return reply.send(latest);
        }
    );

    // GET /robot/:deviceId/health?limit=20
    app.get<{
        Params:      { deviceId: string };
        Querystring: { limit?: string };
    }>('/:deviceId/health', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device || !device.project) return reply.send([]);

        const limit = Math.min(parseInt(req.query.limit ?? '20'), 100);
        const rows = await db.deviceHealth.findMany({
            where:   { projectId: device.project.projectId, deviceName: device.deviceName },
            orderBy: { createdAt: 'desc' },
            take:    isNaN(limit) ? 20 : limit,
        });
        return reply.send(rows);
    });

    // POST /robot/:deviceId/display
    app.post<{
        Params: { deviceId: string };
        Body:   { face: string };
    }>('/:deviceId/display', async (req, reply) => {
        const { deviceId } = req.params;
        const { face } = req.body;
        if (!face) return reply.code(400).send({ error: 'face name required' });
        pushToDevice(deviceId, { type: 'display', face });
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/emotion
    app.post<{
        Params: { deviceId: string };
        Body:   { state: string; energy?: number };
    }>('/:deviceId/emotion', async (req, reply) => {
        pushToDevice(req.params.deviceId, { type: 'emotion', ...req.body });
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/speech
    app.post<{
        Params: { deviceId: string };
        Body:   { text: string };
    }>('/:deviceId/speech', async (req, reply) => {
        pushToDevice(req.params.deviceId, { type: 'speech', ...req.body });
        return reply.code(200).send({ ok: true });
    });

    // PUT /robot/:deviceId/config — push config to device
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

        pushToDevice(deviceId, { type: 'config', ...configWithFaces });
        return reply.code(201).send({ version });
    });

    // POST /robot/:deviceId/actuator
    app.post<{
        Params: { deviceId: string };
        Body:   { pin: string; value: unknown };
    }>('/:deviceId/actuator', async (req, reply) => {
        const { deviceId } = req.params;
        const { pin, value } = req.body;
        pushToDevice(deviceId, { type: 'actuator', pin, value });
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/ota/broadcast — push OTA to all devices of a type
    app.post<{
        Querystring: { deviceType?: string };
        Body:        { version: string; url: string };
    }>('/ota/broadcast', async (req, reply) => {
        const deviceType = req.query.deviceType ?? 'tara-robo';
        const { version, url } = req.body;
        if (!version || !url) return reply.code(400).send({ error: 'version and url required' });

        const devices = await db.device.findMany({ where: { deviceType } });
        let pushed = 0;
        for (const d of devices) {
            if (pushToDevice(d.deviceId, { type: 'ota', version, url })) pushed++;
        }

        return reply.code(200).send({ pushed, version, url });
    });

    // GET /robot/:deviceId/ota-check — check Pocket for a newer version
    app.get<{
        Params:      { deviceId: string };
        Querystring: { artifactoryUrl?: string; apiKey?: string; repo?: string; artifact?: string };
    }>(
        '/:deviceId/ota-check',
        async (req, reply) => {
            const device = await db.device.findUnique({ where: { deviceId: req.params.deviceId } });
            if (!device) return reply.code(404).send({ error: 'device not found' });

            const artifactoryUrl = (req.query.artifactoryUrl ?? '').replace(/\/$/, '');
            const apiKey         = req.query.apiKey   ?? '';
            const repo           = req.query.repo     ?? 'tara-robo';
            const artifactName   = req.query.artifact ?? 'tara-robo';

            if (!artifactoryUrl) return reply.code(400).send({ error: 'artifactoryUrl required' });

            type LatestResponse = { update: boolean; version?: string; fileName?: string; checksum?: string; size?: number; url?: string };
            let latest: LatestResponse;
            try {
                const headers: Record<string, string> = {};
                if (apiKey) headers['X-Pocket-Token'] = apiKey;
                const res = await fetch(
                    `${artifactoryUrl}/api/repos/${repo}/artifacts/latest?artifact=${encodeURIComponent(artifactName)}&current=${encodeURIComponent(device.firmwareVersion)}`,
                    { headers }
                );
                if (!res.ok) return reply.code(502).send({ error: `Pocket returned ${res.status}` });
                latest = (await res.json()) as LatestResponse;
            } catch {
                return reply.code(502).send({ error: `Cannot reach ${artifactoryUrl}` });
            }

            if (!latest.update) return reply.send({ available: false, currentVersion: device.firmwareVersion });

            const downloadUrl = latest.url?.startsWith('http') ? latest.url : `${artifactoryUrl}${latest.url}`;
            return reply.send({ available: true, currentVersion: device.firmwareVersion, latestVersion: latest.version, downloadUrl, checksum: latest.checksum, size: latest.size });
        }
    );

    // POST /robot/:deviceId/ota-check-push — check + push OTA in one step
    app.post<{
        Params: { deviceId: string };
        Body:   { artifactoryUrl: string; apiKey?: string; repo?: string; artifact?: string };
    }>('/:deviceId/ota-check-push', async (req, reply) => {
        const device = await db.device.findUnique({ where: { deviceId: req.params.deviceId } });
        if (!device) return reply.code(404).send({ error: 'device not found' });

        const { artifactoryUrl: rawUrl, apiKey = '', repo = 'tara-robo', artifact = 'tara-robo' } = req.body;
        const artifactoryUrl = rawUrl.replace(/\/$/, '');

        type LatestResponse = { update: boolean; version?: string; url?: string };
        let latest: LatestResponse;
        try {
            const headers: Record<string, string> = {};
            if (apiKey) headers['X-Pocket-Token'] = apiKey;
            const res = await fetch(
                `${artifactoryUrl}/api/repos/${repo}/artifacts/latest?artifact=${encodeURIComponent(artifact)}&current=${encodeURIComponent(device.firmwareVersion)}`,
                { headers }
            );
            if (!res.ok) return reply.code(502).send({ error: `Pocket returned ${res.status}` });
            latest = (await res.json()) as LatestResponse;
        } catch {
            return reply.code(502).send({ error: `Cannot reach ${artifactoryUrl}` });
        }

        if (!latest.update || !latest.version || !latest.url)
            return reply.send({ pushed: false, currentVersion: device.firmwareVersion });

        const downloadUrl = latest.url.startsWith('http') ? latest.url : `${artifactoryUrl}${latest.url}`;
        const pushed = pushToDevice(device.deviceId, { type: 'ota', version: latest.version, url: downloadUrl });
        return reply.code(200).send({ pushed, version: latest.version, url: downloadUrl });
    });

    // POST /robot/:deviceId/ota-push — push OTA directly
    app.post<{
        Params: { deviceId: string };
        Body:   { version: string; url: string };
    }>('/:deviceId/ota-push', async (req, reply) => {
        const device = await db.device.findUnique({ where: { deviceId: req.params.deviceId } });
        if (!device) return reply.code(404).send({ error: 'device not found' });

        const { version, url } = req.body;
        if (!version || !url) return reply.code(400).send({ error: 'version and url required' });

        const pushed = pushToDevice(device.deviceId, { type: 'ota', version, url });
        return reply.code(200).send({ ok: pushed, version });
    });

    // POST /robot/:deviceId/device-config — push device config
    app.post<{
        Params: { deviceId: string };
        Body: { deviceName?: string; deviceType?: string; healthcheck?: { enabled: boolean; frequency: number } };
    }>('/:deviceId/device-config', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device) return reply.code(404).send({ error: 'device not found' });
        if (!device.project) return reply.code(400).send({ error: 'device not assigned to a project' });

        const { deviceName, deviceType, healthcheck } = req.body;

        if (deviceName || deviceType) {
            await db.device.update({
                where: { deviceId: req.params.deviceId },
                data:  { ...(deviceName ? { deviceName } : {}), ...(deviceType ? { deviceType } : {}) },
            });
        }

        const payload = {
            projectId:   device.project.projectId,
            projectName: device.project.name,
            deviceName:  deviceName ?? device.deviceName,
            deviceType:  deviceType ?? device.deviceType,
            healthcheck: healthcheck ?? { enabled: false, frequency: 60 },
        };

        pushToDevice(device.deviceId, { type: 'config', ...payload });
        return reply.code(200).send({ ok: true, payload });
    });

    // POST /robot/:deviceId/display-raw — send raw RGB565 bitmap to device display
    app.post<{
        Params: { deviceId: string };
        Body:   { data: string; width: number; height: number };
    }>('/:deviceId/display-raw', async (req, reply) => {
        const { deviceId } = req.params;
        const { data, width, height } = req.body;
        if (!data || !width || !height) return reply.code(400).send({ error: 'data, width and height required' });
        const pushed = pushToDevice(deviceId, { type: 'display-raw', data, width, height });
        return reply.code(pushed ? 200 : 503).send({ ok: pushed });
    });
}
