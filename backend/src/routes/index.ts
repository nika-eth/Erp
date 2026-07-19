import { Router } from 'express';
import { authRouter } from './auth.routes';
import { catalogosRouter } from './catalogos.routes';
import { clientesRouter } from './clientes.routes';
import { cuentaCorrienteRouter } from './cuentaCorriente.routes';
import { documentosRouter } from './documentos.routes';
import { ventasRouter } from './ventas.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/catalogos', catalogosRouter);
apiRouter.use('/clientes', clientesRouter);
apiRouter.use('/cuenta-corriente', cuentaCorrienteRouter);
apiRouter.use('/documentos', documentosRouter);
apiRouter.use('/ventas', ventasRouter);
