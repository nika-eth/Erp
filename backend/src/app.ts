import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', apiRouter);

  // 404 para rutas no definidas dentro de /api
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'RUTA_NO_ENCONTRADA', message: 'El recurso solicitado no existe.' });
  });

  // Debe registrarse último: captura errores de todos los handlers anteriores.
  app.use(errorHandler);

  return app;
}
