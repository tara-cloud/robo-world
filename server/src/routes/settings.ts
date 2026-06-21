import { FastifyInstance } from 'fastify';
import { db } from '../db';

const DEFAULTS: Record<string, string> = {
    logTtlDays:   '30',
    pocketUrl:    'http://192.168.0.107:30600',
    pocketToken:  '',
};

export async function getSetting(key: string): Promise<string> {
    const row = await db.serverSetting.findUnique({ where: { key } });
    return row?.value ?? DEFAULTS[key] ?? '';
}

export async function settingsRoutes(app: FastifyInstance) {

    // GET /settings — return all known settings with defaults applied
    app.get('/', async () => {
        const rows = await db.serverSetting.findMany();
        const map: Record<string, string> = { ...DEFAULTS };
        for (const r of rows) map[r.key] = r.value;
        return map;
    });

    // PUT /settings — upsert one or more keys
    app.put<{ Body: Record<string, string> }>('/', async (req, reply) => {
        const entries = Object.entries(req.body);
        if (!entries.length) return reply.code(400).send({ error: 'Empty body' });

        for (const [key, value] of entries) {
            await db.serverSetting.upsert({
                where:  { key },
                create: { key, value: String(value) },
                update: { value: String(value) },
            });
        }
        return { ok: true };
    });
}
