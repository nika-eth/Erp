import type { Request, Response } from 'express';
import { listarCamiones, listarZonas } from '../services/logistica.service';

export async function getZonas(_req: Request, res: Response): Promise<void> {
  res.json({ zonas: await listarZonas() });
}

export async function getCamiones(_req: Request, res: Response): Promise<void> {
  res.json({ camiones: await listarCamiones() });
}
