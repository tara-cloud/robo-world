import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { pinStateCache } from '../mqtt';

// Default pins seeded for every new Tara robot
const TARA_DEFAULT_PINS = [
    { pin: '21',  label: 'SDA',   direction: 'i2c',   component: 'SH1106 OLED', protocol: 'I2C',  notes: 'I2C data' },
    { pin: '22',  label: 'SCL',   direction: 'i2c',   component: 'SH1106 OLED', protocol: 'I2C',  notes: 'I2C clock' },
    { pin: '3V3', label: 'VCC',   direction: 'power', component: 'Power Rail',  protocol: null,   notes: '3.3V supply' },
    { pin: 'GND', label: 'GND',   direction: 'power', component: 'Ground',      protocol: null,   notes: 'Ground' },
];

async function seedDefaultPins(deviceId: string) {
    const existing = await db.devicePin.count({ where: { deviceId } });
    if (existing > 0) return;
    await db.devicePin.createMany({
        data: TARA_DEFAULT_PINS.map(p => ({ ...p, deviceId })),
        skipDuplicates: true,
    });
}

export async function hardwareRoutes(app: FastifyInstance) {
    // ── Pins ──────────────────────────────────────────────────────────────────

    // GET /robot/:deviceId/pins
    app.get<{ Params: { deviceId: string } }>(
        '/:deviceId/pins',
        async (req, reply) => {
            const { deviceId } = req.params;
            await seedDefaultPins(deviceId);
            const pins = await db.devicePin.findMany({
                where: { deviceId },
                orderBy: { pin: 'asc' },
            });
            return pins;
        }
    );

    // POST /robot/:deviceId/pins — upsert by (deviceId, pin)
    app.post<{
        Params: { deviceId: string };
        Body: {
            pin: string;
            label: string;
            direction: string;
            component: string;
            protocol?: string;
            notes?: string;
        };
    }>('/:deviceId/pins', async (req, reply) => {
        const { deviceId } = req.params;
        const { pin, label, direction, component, protocol, notes } = req.body;

        const result = await db.devicePin.upsert({
            where:  { deviceId_pin: { deviceId, pin } },
            create: { deviceId, pin, label, direction, component, protocol, notes },
            update: { label, direction, component, protocol, notes },
        });
        return reply.code(201).send(result);
    });

    // DELETE /robot/:deviceId/pins/:pin
    app.delete<{ Params: { deviceId: string; pin: string } }>(
        '/:deviceId/pins/:pin',
        async (req, reply) => {
            const { deviceId, pin } = req.params;
            await db.devicePin.delete({
                where: { deviceId_pin: { deviceId, pin } },
            });
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

    // POST /robot/:deviceId/pipeline — create rule
    app.post<{
        Params: { deviceId: string };
        Body: {
            pinLabel: string;
            action: string;
            config: Record<string, unknown>;
            enabled?: boolean;
        };
    }>('/:deviceId/pipeline', async (req, reply) => {
        const { deviceId } = req.params;
        const { pinLabel, action, config, enabled = true } = req.body;

        const rule = await db.pipelineRule.create({
            data: {
                deviceId,
                pinLabel,
                action,
                config: config as object,
                enabled,
            },
        });
        return reply.code(201).send(rule);
    });

    // PATCH /robot/:deviceId/pipeline/:id — toggle enabled or update
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
