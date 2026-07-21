import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { type ContextoAcceso, verificarAccesoSucursal } from '../utils/autorizacion.utils';
import { redondearMoneda } from '../utils/documento.utils';
import type {
  ActualizarCotInput,
  AsignarEnvioInput,
  Camion,
  CamionJornada,
  DocumentoPendiente,
  EnvioAsignado,
  Zona,
} from '../types/domain';

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

/** Remitos facturados (no presupuestos) que todavía no fueron asignados a ningún camión. */
export async function listarDocumentosPendientes(contexto: ContextoAcceso): Promise<DocumentoPendiente[]> {
  const condicionSucursal = contexto.rol === 'VENDEDOR' ? 'AND d.id_sucursal_origen = $1' : '';
  const valores = contexto.rol === 'VENDEDOR' ? [contexto.id_sucursal] : [];

  const { rows } = await pool.query<{
    id_documento: number;
    nro_remito: number | null;
    cliente: string;
    zona: string | null;
    casilleros_requeridos: number | null;
    kilos_totales: string;
  }>(
    `SELECT d.id_documento, d.nro_remito, cl.nombre AS cliente, z.nombre AS zona,
            z.casilleros_requeridos,
            COALESCE((SELECT SUM(dd.cantidad * dd.peso_teorico_kg) FROM documentos_detalles dd WHERE dd.id_documento = d.id_documento), 0) AS kilos_totales
     FROM documentos d
     JOIN clientes cl ON cl.id_cliente = d.cliente_id
     LEFT JOIN zonas z ON z.id_zona = d.id_zona
     LEFT JOIN envios e ON e.id_documento = d.id_documento
     WHERE d.tipo_documento IN ('FACTURA_A', 'FACTURA_B') AND e.id_envio IS NULL ${condicionSucursal}
     ORDER BY d.fecha DESC
     LIMIT 100`,
    valores,
  );

  return rows.map((r) => ({
    id_documento: r.id_documento,
    nro_remito: r.nro_remito,
    cliente: r.cliente,
    zona: r.zona,
    casillerosRequeridos: r.casilleros_requeridos,
    kilosTotales: redondearMoneda(Number(r.kilos_totales)),
  }));
}

/**
 * Ocupación de todos los camiones para una fecha de despacho puntual. Un
 * camión es un recurso físico compartido entre sucursales: si un VENDEDOR ve
 * un envío de otra sucursal, se redactan los datos identificatorios
 * (cliente/zona/remito) pero se mantienen `casillerosRequeridos`/
 * `kilosTotales` reales — ocultar la ocupación real induciría a error sobre
 * cuánto cupo queda disponible en el camión.
 */
export async function obtenerOcupacionDiaria(fecha: string, contexto: ContextoAcceso): Promise<CamionJornada[]> {
  if (!FECHA_REGEX.test(fecha)) {
    throw AppError.badRequest('FECHA_INVALIDA', 'fecha debe tener formato YYYY-MM-DD.');
  }

  const { rows } = await pool.query<{
    id_camion: number;
    chofer: string;
    patente: string;
    capacidad_casilleros: number;
    capacidad_kilos_max: string;
    id_envio: number | null;
    id_documento: number | null;
    id_sucursal_origen: number | null;
    nro_remito: number | null;
    cliente_nombre: string | null;
    zona_nombre: string | null;
    casilleros_ocupados: number | null;
    kilos_asignados: string | null;
    nro_cot: string | null;
  }>(
    `SELECT
       c.id_camion, c.chofer, c.patente, c.capacidad_casilleros, c.capacidad_kilos_max,
       e.id_envio, e.id_documento, d.id_sucursal_origen, d.nro_remito,
       cl.nombre AS cliente_nombre, z.nombre AS zona_nombre,
       e.casilleros_ocupados, e.kilos_asignados, e.nro_cot
     FROM camiones c
     LEFT JOIN envios e ON e.id_camion = c.id_camion AND e.fecha_despacho = $1
     LEFT JOIN documentos d ON d.id_documento = e.id_documento
     LEFT JOIN clientes cl ON cl.id_cliente = d.cliente_id
     LEFT JOIN zonas z ON z.id_zona = d.id_zona
     ORDER BY c.chofer, e.id_envio`,
    [fecha],
  );

  const camiones = new Map<number, CamionJornada>();
  for (const r of rows) {
    let camion = camiones.get(r.id_camion);
    if (!camion) {
      camion = {
        id_camion: r.id_camion,
        chofer: r.chofer,
        patente: r.patente,
        capacidadCasilleros: r.capacidad_casilleros,
        capacidadKilosMax: Number(r.capacidad_kilos_max),
        envios: [],
      };
      camiones.set(r.id_camion, camion);
    }
    if (r.id_envio) {
      const esForaneo = contexto.rol === 'VENDEDOR' && r.id_sucursal_origen !== contexto.id_sucursal;
      const envio: EnvioAsignado = {
        id_envio: r.id_envio,
        id_documento: r.id_documento!,
        nro_remito: esForaneo ? null : r.nro_remito,
        cliente: esForaneo ? '(otra sucursal)' : r.cliente_nombre ?? '',
        zona: esForaneo ? '' : r.zona_nombre ?? '',
        casillerosRequeridos: r.casilleros_ocupados!,
        kilosTotales: Number(r.kilos_asignados),
        nro_cot: esForaneo ? null : r.nro_cot,
      };
      camion.envios.push(envio);
    }
  }

  return Array.from(camiones.values());
}

/**
 * Asigna un remito facturado a un camión en una fecha de despacho,
 * validando que no se supere ni la capacidad de kilos ni la de casilleros
 * del camión para ese día. Todo dentro de una transacción que bloquea la
 * fila del camión (`SELECT ... FOR UPDATE`) para serializar asignaciones
 * concurrentes al mismo camión/día y evitar sobre-reservar cupo.
 */
export async function asignarEnvio(input: AsignarEnvioInput, contexto: ContextoAcceso): Promise<EnvioAsignado> {
  if (!Number.isInteger(input.id_camion) || !Number.isInteger(input.id_documento)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_camion e id_documento son requeridos y deben ser enteros.');
  }
  if (!FECHA_REGEX.test(input.fecha_despacho ?? '')) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_despacho es requerida con formato YYYY-MM-DD.');
  }

  return withTransaction(async (client) => {
    const { rows: camionRows } = await client.query<Camion>(
      `SELECT id_camion, patente, chofer, capacidad_casilleros, capacidad_kilos_max
       FROM camiones WHERE id_camion = $1 FOR UPDATE`,
      [input.id_camion],
    );
    const camion = camionRows[0];
    if (!camion) {
      throw AppError.notFound('CAMION_NO_ENCONTRADO', `No existe el camión id_camion=${input.id_camion}`);
    }

    const { rows: documentoRows } = await client.query<{
      id_documento: number;
      id_sucursal_origen: number;
      nro_remito: number | null;
      tipo_documento: string;
      kilos_totales: string;
      id_zona: number | null;
      cliente_nombre: string;
    }>(
      `SELECT d.id_documento, d.id_sucursal_origen, d.nro_remito, d.tipo_documento, d.id_zona, cl.nombre AS cliente_nombre,
              COALESCE((SELECT SUM(dd.cantidad * dd.peso_teorico_kg) FROM documentos_detalles dd WHERE dd.id_documento = d.id_documento), 0) AS kilos_totales
       FROM documentos d
       JOIN clientes cl ON cl.id_cliente = d.cliente_id
       WHERE d.id_documento = $1`,
      [input.id_documento],
    );
    const documento = documentoRows[0];
    if (!documento) {
      throw AppError.notFound('DOCUMENTO_NO_ENCONTRADO', `No existe el documento id_documento=${input.id_documento}`);
    }
    verificarAccesoSucursal(contexto, documento.id_sucursal_origen);
    if (documento.tipo_documento === 'PRESUPUESTO') {
      throw AppError.badRequest(
        'DOCUMENTO_NO_FACTURADO',
        'Un presupuesto no puede despacharse; primero hay que facturarlo (F12).',
      );
    }
    if (!documento.id_zona) {
      throw AppError.badRequest(
        'CLIENTE_SIN_ZONA',
        'El cliente de este remito no tiene zona asignada; no se puede calcular cuántos casilleros ocupa.',
      );
    }

    const { rows: zonaRows } = await client.query<Zona>(
      `SELECT id_zona, nombre, casilleros_requeridos FROM zonas WHERE id_zona = $1`,
      [documento.id_zona],
    );
    const zona = zonaRows[0];
    if (!zona) {
      throw AppError.badRequest('ZONA_INVALIDA', 'La zona asignada al cliente ya no existe.');
    }

    const kilosTotales = redondearMoneda(Number(documento.kilos_totales));

    const { rows: ocupacionRows } = await client.query<{ casilleros_usados: string; kilos_usados: string }>(
      `SELECT COALESCE(SUM(casilleros_ocupados), 0) AS casilleros_usados,
              COALESCE(SUM(kilos_asignados), 0) AS kilos_usados
       FROM envios WHERE id_camion = $1 AND fecha_despacho = $2`,
      [input.id_camion, input.fecha_despacho],
    );
    const casillerosUsados = Number(ocupacionRows[0].casilleros_usados);
    const kilosUsados = Number(ocupacionRows[0].kilos_usados);

    const kilosDisponibles = redondearMoneda(Number(camion.capacidad_kilos_max) - kilosUsados);
    if (kilosTotales > kilosDisponibles) {
      throw AppError.conflict(
        'CAPACIDAD_KILOS_EXCEDIDA',
        `El camión ${camion.patente} sólo tiene ${kilosDisponibles} kg disponibles el ${input.fecha_despacho} ` +
          `y el remito pesa ${kilosTotales} kg.`,
      );
    }

    const casillerosDisponibles = camion.capacidad_casilleros - casillerosUsados;
    if (zona.casilleros_requeridos > casillerosDisponibles) {
      throw AppError.conflict(
        'CAPACIDAD_CASILLEROS_EXCEDIDA',
        `El camión ${camion.patente} sólo tiene ${casillerosDisponibles} casilleros disponibles el ${input.fecha_despacho} ` +
          `y la zona "${zona.nombre}" del cliente requiere ${zona.casilleros_requeridos}.`,
      );
    }

    const { rows: envioRows } = await client.query<{ id_envio: number }>(
      `INSERT INTO envios (id_camion, id_documento, fecha_despacho, casilleros_ocupados, kilos_asignados)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_envio`,
      [input.id_camion, input.id_documento, input.fecha_despacho, zona.casilleros_requeridos, kilosTotales],
    );

    return {
      id_envio: envioRows[0].id_envio,
      id_documento: documento.id_documento,
      nro_remito: documento.nro_remito,
      cliente: documento.cliente_nombre,
      zona: zona.nombre,
      casillerosRequeridos: zona.casilleros_requeridos,
      kilosTotales,
      nro_cot: null,
    };
  });
}

/**
 * Carga el Código de Operación de Traslado (COT, exigido por ARBA) de un
 * envío ya asignado a un camión. No afecta la asignación en sí — sólo el
 * dato del COT — así que no hace falta transacción ni bloquear filas.
 */
export async function actualizarCotEnvio(
  id_envio: number,
  input: ActualizarCotInput,
  contexto: ContextoAcceso,
): Promise<EnvioAsignado> {
  const nroCot = input.nro_cot?.trim() ?? '';
  if (!nroCot) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'nro_cot es requerido.');
  }

  const { rows: sucursalRows } = await pool.query<{ id_sucursal_origen: number }>(
    `SELECT d.id_sucursal_origen FROM envios e JOIN documentos d ON d.id_documento = e.id_documento WHERE e.id_envio = $1`,
    [id_envio],
  );
  const sucursalEnvio = sucursalRows[0];
  if (!sucursalEnvio) {
    throw AppError.notFound('ENVIO_NO_ENCONTRADO', `No existe el envío id_envio=${id_envio}`);
  }
  verificarAccesoSucursal(contexto, sucursalEnvio.id_sucursal_origen);

  const { rows } = await pool.query<{
    id_envio: number;
    id_documento: number;
    nro_remito: number | null;
    cliente_nombre: string;
    zona_nombre: string;
    casilleros_ocupados: number;
    kilos_asignados: string;
    nro_cot: string | null;
  }>(
    `UPDATE envios SET nro_cot = $1 WHERE id_envio = $2
     RETURNING id_envio, id_documento, casilleros_ocupados, kilos_asignados, nro_cot`,
    [nroCot, id_envio],
  );
  const envio = rows[0];
  if (!envio) {
    throw AppError.notFound('ENVIO_NO_ENCONTRADO', `No existe el envío id_envio=${id_envio}`);
  }

  const { rows: detalleRows } = await pool.query<{
    nro_remito: number | null;
    cliente_nombre: string;
    zona_nombre: string | null;
  }>(
    `SELECT d.nro_remito, cl.nombre AS cliente_nombre, z.nombre AS zona_nombre
     FROM documentos d
     JOIN clientes cl ON cl.id_cliente = d.cliente_id
     LEFT JOIN zonas z ON z.id_zona = d.id_zona
     WHERE d.id_documento = $1`,
    [envio.id_documento],
  );
  const detalle = detalleRows[0];

  return {
    id_envio: envio.id_envio,
    id_documento: envio.id_documento,
    nro_remito: detalle?.nro_remito ?? null,
    cliente: detalle?.cliente_nombre ?? '',
    zona: detalle?.zona_nombre ?? '',
    casillerosRequeridos: envio.casilleros_ocupados,
    kilosTotales: Number(envio.kilos_asignados),
    nro_cot: envio.nro_cot,
  };
}
