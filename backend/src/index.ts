import express from 'express';
import cors from 'cors';
import vendorRoutes from './routes/vendors';
import scriptRoutes from './routes/scripts';
import eventRoutes from './routes/events';
import analyticsRoutes from './routes/analytics';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/vendors', vendorRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, HOST, () => {
  console.log(`Automate server listening on http://${HOST}:${PORT}`);
});
