import { Router } from 'express';
import { afipRouter } from './afip.routes';
import { authRouter } from './auth.routes';
import { catalogosRouter } from './catalogos.routes';
import { clientesRouter } from './clientes.routes';
import { cuentaCorrienteRouter } from './cuentaCorriente.routes';
import { documentosRouter } from './documentos.routes';
import { logisticaRouter } from './logistica.routes';
import { productosRouter } from './productos.routes';
import { recibosRouter } from './recibos.routes';
import { ventasRouter } from './ventas.routes';

export const apiRouter = Router();

apiRouter.use('/afip', afipRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/catalogos', catalogosRouter);
apiRouter.use('/clientes', clientesRouter);
apiRouter.use('/cuenta-corriente', cuentaCorrienteRouter);
apiRouter.use('/documentos', documentosRouter);
apiRouter.use('/logistica', logisticaRouter);
apiRouter.use('/productos', productosRouter);
apiRouter.use('/recibos', recibosRouter);
apiRouter.use('/ventas', ventasRouter);
