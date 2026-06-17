import { FastifyInstance } from 'fastify';
import { db } from '../db';

export async function configRoutes(app: FastifyInstance) {
    // GET /device/config/version/:deviceId
    app.get<{ Params: { deviceId: string } }>(
        '/config/version/:deviceId',
        async (req, reply) => {
            const { deviceId } = req.params;
            const latest = await db.deviceConfig.findFirst({
                where: { deviceId },
                orderBy: { createdAt: 'desc' },
            });

            if (!latest) return reply.code(404).send({ error: 'No config found' });
            return { version: latest.version };
        }
    );

    // GET /device/config/:deviceId
    app.get<{ Params: { deviceId: string } }>(
        '/config/:deviceId',
        async (req, reply) => {
            const { deviceId } = req.params;
            const latest = await db.deviceConfig.findFirst({
                where: { deviceId },
                orderBy: { createdAt: 'desc' },
            });

            if (!latest) return reply.code(404).send({ error: 'No config found' });

            reply.header('Config-Version', latest.version);
            return latest.config;
        }
    );

    // PUT /device/config/:deviceId — push new config version
    app.put<{
        Params: { deviceId: string };
        Body: { config: Record<string, unknown> };
    }>('/config/:deviceId', async (req, reply) => {
        const { deviceId } = req.params;
        const { config }   = req.body;

        const last = await db.deviceConfig.findFirst({
            where: { deviceId },
            orderBy: { createdAt: 'desc' },
        });
        const nextVersion = String((parseInt(last?.version ?? '0') + 1));

        const saved = await db.deviceConfig.create({
            data: { deviceId, version: nextVersion, config: config as object },
        });

        return reply.code(201).send({ version: saved.version });
    });
}
