import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { publishToRobot } from '../mqtt';

export async function robotRoutes(app: FastifyInstance) {
    // GET /robot — list all registered robots with latest health
    app.get('/', async () => {
        return db.device.findMany({
            where:   { deviceType: 'robot' },
            orderBy: { lastSeen: 'desc' },
            include: {
                readings: { take: 1, orderBy: { recordedAt: 'desc' } },
            },
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

    // POST /robot/:deviceId/display — send display command
    app.post<{
        Params: { deviceId: string };
        Body:   { face: string };
    }>('/:deviceId/display', async (req, reply) => {
        publishToRobot(req.params.deviceId, 'display', req.body);
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/emotion — send emotion command
    app.post<{
        Params: { deviceId: string };
        Body:   { state: string; energy?: number };
    }>('/:deviceId/emotion', async (req, reply) => {
        publishToRobot(req.params.deviceId, 'emotion', req.body);
        return reply.code(200).send({ ok: true });
    });

    // POST /robot/:deviceId/speech — send speech command
    app.post<{
        Params: { deviceId: string };
        Body:   { text: string };
    }>('/:deviceId/speech', async (req, reply) => {
        publishToRobot(req.params.deviceId, 'speech', req.body);
        return reply.code(200).send({ ok: true });
    });

    // PUT /robot/:deviceId/config — push config update
    app.put<{
        Params: { deviceId: string };
        Body:   Record<string, unknown>;
    }>('/:deviceId/config', async (req, reply) => {
        const { deviceId } = req.params;

        const last = await db.deviceConfig.findFirst({
            where:   { deviceId },
            orderBy: { createdAt: 'desc' },
        });
        const version = String((parseInt(last?.version ?? '0') + 1));

        await db.deviceConfig.create({
            data: { deviceId, version, config: req.body as Record<string, string | number | boolean | null> },
        });

        publishToRobot(deviceId, 'config', { ...req.body, version }, 1);
        return reply.code(201).send({ version });
    });
}
