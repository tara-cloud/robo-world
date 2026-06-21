import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { publishToRobot, getMqtt } from '../mqtt';
import { buildFacesMap } from './face';
import { getSetting } from './settings';

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
                    project:  true,
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
    // Caller (e.g. Pocket) sends the complete ready-to-use download URL
    app.post<{
        Querystring: { deviceType?: string };
        Body:        { version: string; url: string; apiKey?: string };
    }>('/ota/broadcast', async (req, reply) => {
        const deviceType = req.query.deviceType ?? 'robot';
        const { version, url, apiKey } = req.body;

        if (!version || !url) return reply.code(400).send({ error: 'version and url required' });

        const devices = await db.device.findMany({
            where:   { deviceType },
            include: { project: { select: { projectId: true } } },
        });

        for (const d of devices) {
            if (!d.project?.projectId) continue;
            const topic   = `${d.project.projectId}.${d.deviceName}.ota`;
            const payload: Record<string, string> = { version, url };
            if (apiKey) payload.apiKey = apiKey;
            getMqtt().publish(topic, JSON.stringify(payload), { qos: 1 });
        }

        return reply.code(200).send({ pushed: devices.length, version, url });
    });

    // GET /robot/:deviceId/ota-check — check Pocket for a newer version
    // Query: artifactoryUrl, apiKey, repo, artifact (artifact name, e.g. tara-robot)
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
            const repo           = req.query.repo     ?? 'electro-firmware';
            const artifactName   = req.query.artifact ?? 'tara-robot';

            if (!artifactoryUrl) return reply.code(400).send({ error: 'artifactoryUrl required' });

            // Use Pocket's /api/repos/:name/artifacts/latest endpoint
            type LatestResponse = {
                update: boolean;
                version?: string;
                fileName?: string;
                checksum?: string;
                size?: number;
                url?: string;
            };

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

            if (!latest.update) {
                return reply.send({ available: false, currentVersion: device.firmwareVersion });
            }

            // Build full download URL from the url field Pocket returns
            const downloadUrl = latest.url?.startsWith('http')
                ? latest.url
                : `${artifactoryUrl}${latest.url}`;

            return reply.send({
                available:      true,
                currentVersion: device.firmwareVersion,
                latestVersion:  latest.version,
                downloadUrl,
                checksum:       latest.checksum,
                size:           latest.size,
            });
        }
    );

    // POST /robot/:deviceId/ota-check-push — check latest and if available push OTA to device in one step
    app.post<{
        Params: { deviceId: string };
        Body:   { artifactoryUrl: string; apiKey?: string; repo?: string; artifact?: string };
    }>('/:deviceId/ota-check-push', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device) return reply.code(404).send({ error: 'device not found' });
        if (!device.project) return reply.code(400).send({ error: 'device not assigned to a project' });

        const { artifactoryUrl: rawUrl, apiKey = '', repo = 'electro-firmware', artifact = 'tara-robot' } = req.body;
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

        if (!latest.update || !latest.version || !latest.url) {
            return reply.send({ pushed: false, currentVersion: device.firmwareVersion });
        }

        const downloadUrl = latest.url.startsWith('http') ? latest.url : `${artifactoryUrl}${latest.url}`;
        const topic   = `${device.project.projectId}.${device.deviceName}.ota`;
        const payload: Record<string, string> = { version: latest.version, url: downloadUrl };
        if (apiKey) payload.apiKey = apiKey;

        getMqtt().publish(topic, JSON.stringify(payload), { qos: 1 });
        return reply.code(200).send({ pushed: true, topic, version: latest.version, url: downloadUrl });
    });


    // POST /robot/:deviceId/ota-push — publish OTA command directly via MQTT
    // Topic: {projectId}.{deviceName}.ota  payload: { version, url, apiKey }
    // apiKey is read from DB settings (pocketToken) — UI doesn't need to send it
    app.post<{
        Params: { deviceId: string };
        Body:   { version: string; url: string };
    }>('/:deviceId/ota-push', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device) return reply.code(404).send({ error: 'device not found' });
        if (!device.project) return reply.code(400).send({ error: 'device not assigned to a project' });

        const { version, url } = req.body;
        if (!version || !url) return reply.code(400).send({ error: 'version and url required' });

        // Always pull pocketToken from DB — single source of truth
        const apiKey = await getSetting('pocketToken');

        const topic = `${device.project.projectId}.${device.deviceName}.ota`;
        const payload: Record<string, string> = { version, url };
        if (apiKey) payload.apiKey = apiKey;

        getMqtt().publish(topic, JSON.stringify(payload), { qos: 1 });
        return reply.code(200).send({ ok: true, topic, version });
    });

    // POST /robot/:deviceId/device-config — publish device config packet via MQTT
    // Topic: {projectId}.{deviceName}.config
    app.post<{
        Params: { deviceId: string };
        Body: {
            deviceName?: string;
            deviceType?: string;
            healthcheck?: { enabled: boolean; frequency: number };
        };
    }>('/:deviceId/device-config', async (req, reply) => {
        const device = await db.device.findUnique({
            where:   { deviceId: req.params.deviceId },
            include: { project: true },
        });
        if (!device) return reply.code(404).send({ error: 'device not found' });
        if (!device.project) return reply.code(400).send({ error: 'device not assigned to a project' });

        const { deviceName, deviceType, healthcheck } = req.body;

        // Persist identity changes if provided
        if (deviceName || deviceType) {
            await db.device.update({
                where: { deviceId: req.params.deviceId },
                data: {
                    ...(deviceName ? { deviceName } : {}),
                    ...(deviceType ? { deviceType } : {}),
                },
            });
        }

        const payload = {
            projectID:   device.project.projectId,
            projectName: device.project.name,
            deviceName:  deviceName ?? device.deviceName,
            deviceType:  deviceType ?? device.deviceType,
            healthcheck: healthcheck ?? { enabled: false, frequency: 60 },
        };

        const topic = `${device.project.projectId}.${payload.deviceName}.config`;
        getMqtt().publish(topic, JSON.stringify(payload), { qos: 1 });

        return reply.code(200).send({ ok: true, topic, payload });
    });
}
