import { pool } from '../config/db';
import type { Camion, Zona } from '../types/domain';

/**
 * Datos maestros de logística (camiones y zonas), compartidos por la venta
 * (alta de cliente, `CrearCliente.tsx`) y la Pizarra de Camiones
 * (`PizarraCamiones.tsx`). El circuito viejo de Control de Ruteo
 * (envios/asignarEnvio/COT por envío/Ocupación Diaria) se retiró — la
 * Pizarra de Camiones (Hojas de Ruta) es ahora la única fuente de verdad
 * para despachar por camión.
 */
export async function listarZonas(): Promise<Zona[]> {
  const { rows } = await pool.query<Zona>(
    `SELECT id_zona, nombre, casilleros_requeridos FROM zonas ORDER BY casilleros_requeridos`,
  );
  return rows;
}

export async function listarCamiones(): Promise<Camion[]> {
  const { rows } = await pool.query<Camion>(
    `SELECT id_camion, patente, chofer, capacidad_casilleros, capacidad_kilos_max FROM camiones ORDER BY chofer`,
  );
  return rows;
}
