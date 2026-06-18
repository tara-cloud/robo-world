import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { pinStateCache } from '../mqtt';

export async function hardwareRoutes(app: FastifyInstance) {
    // ── Components + Pins ─────────────────────────────────────────────────────

    // GET /robot/:deviceId/components — all components with their pins
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/components',
        async (req) => {
            const { deviceId } = req.params;
            return db.deviceComponent.findMany({
                where: { deviceId },
                include: { pins: { orderBy: { pin: 'asc' } } },
                orderBy: { name: 'asc' },
            });
        }
    );

    // GET /robot/:deviceId/pins — flat list across all components
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/pins',
        async (req) => {
            const { deviceId } = req.params;
            return db.devicePin.findMany({
                where: { deviceId },
                include: { component: { select: { name: true, type: true, protocol: true } } },
                orderBy: { pin: 'asc' },
            });
        }
    );

    // DELETE /robot/:deviceId/pins/:pin
    app.delete<{ Params: { deviceId: string; pin: string } }>(
        '/:deviceId/pins/:pin',
        async (req, reply) => {
            const { deviceId, pin } = req.params;
            await db.devicePin.delete({ where: { deviceId_pin: { deviceId, pin } } });
            return reply.code(200).send({ ok: true });
        }
    );

    // ── Pipeline ──────────────────────────────────────────────────────────────

    // GET /robot/:deviceId/pipeline
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/pipeline',
        async (req) => {
            const { deviceId } = req.params;
            return db.pipelineRule.findMany({
                where: { deviceId },
                orderBy: { createdAt: 'asc' },
            });
        }
    );

    // POST /robot/:deviceId/pipeline
    app.post<{
        Params: { deviceId: string };
        Body: { pinLabel: string; action: string; config: Record<string, unknown>; enabled?: boolean };
    }>('/:deviceId/pipeline', async (req, reply) => {
        const { deviceId } = req.params;
        const { pinLabel, action, config, enabled = true } = req.body;
        const rule = await db.pipelineRule.create({
            data: { deviceId, pinLabel, action, config: config as object, enabled },
        });
        return reply.code(201).send(rule);
    });

    // PATCH /robot/:deviceId/pipeline/:id
    app.patch<{
        Params: { deviceId: string; id: string };
        Body: { enabled?: boolean; config?: Record<string, unknown> };
    }>('/:deviceId/pipeline/:id', async (req, reply) => {
        const { id } = req.params;
        const { enabled, config } = req.body;
        const rule = await db.pipelineRule.update({
            where: { id },
            data: {
                ...(enabled !== undefined ? { enabled } : {}),
                ...(config  !== undefined ? { config: config as object } : {}),
            },
        });
        return reply.code(200).send(rule);
    });

    // DELETE /robot/:deviceId/pipeline/:id
    app.delete<{ Params: { deviceId: string; id: string } }>(
        '/:deviceId/pipeline/:id',
        async (req, reply) => {
            const { id } = req.params;
            await db.pipelineRule.delete({ where: { id } });
            return reply.code(200).send({ ok: true });
        }
    );

    // GET /robot/:deviceId/pin_state — live pin values from MQTT cache
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/pin_state',
        async (req) => pinStateCache[req.params.deviceId] ?? {}
    );
}
