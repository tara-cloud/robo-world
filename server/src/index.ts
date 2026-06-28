import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { deviceRoutes } from './routes/device';
import { configRoutes } from './routes/config';
import { sensorRoutes } from './routes/sensor';
import { robotRoutes }    from './routes/robot';
import { hardwareRoutes } from './routes/hardware';
import { faceRoutes, seedFaces } from './routes/face';
import { projectRoutes } from './routes/project';
import { settingsRoutes, getSetting } from './routes/settings';
import { initMqtt } from './mqtt';
import { initSocket } from './socket';
import { db } from './db';

const app = Fastify({ logger: true });

// Normalise double-slash URLs from firmware that saves serverUrl with trailing slash
app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('//')) {
        req.raw.url = req.url.replace(/^\/+/, '/');
    }
});

app.register(cors, { origin: true });

// Serve the dashboard UI from /public
app.register(staticFiles, {
    root:   path.join(__dirname, '..', 'public'),
    prefix: '/',
});

app.register(deviceRoutes, { prefix: '/device' });
app.register(configRoutes, { prefix: '/device' });
app.register(sensorRoutes, { prefix: '/device' });
app.register(robotRoutes,    { prefix: '/robot' });
app.register(hardwareRoutes, { prefix: '/robot' });
app.register(faceRoutes,     { prefix: '/faces' });
app.register(projectRoutes,  { prefix: '/projects' });
app.register(settingsRoutes, { prefix: '/settings' });

app.get('/health', async () => ({ status: 'ok', service: 'robo-world' }));

initMqtt();
initSocket();
seedFaces();

async function pruneOldData() {
    const logTtl       = parseInt(await getSetting('logTtlDays'));
    const healthTtlHrs = parseInt(await getSetting('healthTtlHours'));

    if (logTtl > 0) {
        const cutoff = new Date(Date.now() - logTtl * 86_400_000);
        const { count } = await db.deviceLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (count > 0) console.log(`[LogPrune] deleted ${count} log entries older than ${logTtl}d`);
    }
    if (healthTtlHrs > 0) {
        const cutoff = new Date(Date.now() - healthTtlHrs * 3_600_000);
        const { count } = await db.deviceHealth.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (count > 0) console.log(`[HealthPrune] deleted ${count} health entries older than ${healthTtlHrs}h`);
    }
}

// Run at startup then every hour
pruneOldData();
setInterval(pruneOldData, 60 * 60 * 1000);

const port = parseInt(process.env.PORT ?? '4000');
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }, (err) => {
    if (err) { app.log.error(err); process.exit(1); }
    app.log.info(`Electron server on ${host}:${port}`);
});
