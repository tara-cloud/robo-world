import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import path from 'path';
import { deviceRoutes } from './routes/device';
import { configRoutes } from './routes/config';
import { sensorRoutes } from './routes/sensor';
import { robotRoutes }  from './routes/robot';
import { initMqtt } from './mqtt';

const app = Fastify({ logger: true });

app.register(cors, { origin: true });

// Serve the dashboard UI from /public
app.register(staticFiles, {
    root:   path.join(__dirname, '..', 'public'),
    prefix: '/',
});

app.register(deviceRoutes, { prefix: '/device' });
app.register(configRoutes, { prefix: '/device' });
app.register(sensorRoutes, { prefix: '/device' });
app.register(robotRoutes,  { prefix: '/robot' });

app.get('/health', async () => ({ status: 'ok' }));

initMqtt();

const port = parseInt(process.env.PORT ?? '4000');
const host = process.env.HOST ?? '0.0.0.0';

app.listen({ port, host }, (err) => {
    if (err) { app.log.error(err); process.exit(1); }
    app.log.info(`Electro server on ${host}:${port}`);
});
