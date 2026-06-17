import { FastifyInstance } from 'fastify';
import { db } from '../db';

export async function sensorRoutes(app: FastifyInstance) {
    // POST /device/sensor/:deviceId
    app.post<{
        Params: { deviceId: string };
        Body: { temperature?: number; humidity?: number; light?: number; [k: string]: unknown };
    }>('/sensor/:deviceId', async (req, reply) => {
        const { deviceId }                      = req.params;
        const { temperature, humidity, light, ...extra } = req.body;

        await db.sensorReading.create({
            data: {
                deviceId,
                temperature,
                humidity,
                light,
                extra: Object.keys(extra).length ? (extra as object) : undefined,
            },
        });

        return reply.code(201).send({ ok: true });
    });

    // GET /device/sensor/:deviceId?limit=50
    app.get<{
        Params: { deviceId: string };
        Querystring: { limit?: string };
    }>('/sensor/:deviceId', async (req, reply) => {
        const { deviceId } = req.params;
        const limit        = Math.min(parseInt(req.query.limit ?? '50'), 500);

        const readings = await db.sensorReading.findMany({
            where: { deviceId },
            orderBy: { recordedAt: 'desc' },
            take: limit,
        });

        return readings;
    });
}
