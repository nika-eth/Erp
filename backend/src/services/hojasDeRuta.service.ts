import type { Pool, PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { AppError } from '../utils/AppError';
import { type ContextoAcceso, verificarAccesoSucursal } from '../utils/autorizacion.utils';
import { redondearMoneda } from '../utils/documento.utils';
import { bloquearOrdenEntregaPorId, cumplirOrdenEntrega, obtenerDetallesOrdenEntrega } from './ordenesEntrega.service';
import type {
  ActualizarCotInput,
  AgregarOrdenAHojaInput,
  AnularHojaDeRutaInput,
  Camion,
  CrearHojaDeRutaInput,
  HojaDeRuta,
  HojaDeRutaOrden,
  HojaDeRutaResumen,
  OrdenEntregaBacklog,
  Zona,
} from '../types/domain';

type Queryable = Pool | PoolClient;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const HOJA_DE_RUTA_COLUMNAS = `id_hoja_de_ruta, id_camion, chofer, fecha_despacho, estado, id_usuario_creo, fecha_creacion,
  id_usuario_confirmo, fecha_confirmacion, motivo_anulacion, id_usuario_anulo, fecha_anulacion, nro_cot`;

async function obtenerOrdenesDeHoja(client: Queryable, id_hoja_de_ruta: number): Promise<HojaDeRutaOrden[]> {
  const { rows } = await client.query<{
    id_hoja_de_ruta_orden: number;
    id_hoja_de_ruta: number;
    id_orden_entrega: number;
    nro_orden: string | null;
    cliente: string;
    id_sucursal_despacho: number;
    casilleros_ocupados: number;
    kilos_asignados: string;
  }>(
    `SELECT hro.id_hoja_de_ruta_orden, hro.id_hoja_de_ruta, hro.id_orden_entrega, oe.nro_orden, cl.nombre AS cliente,
            hro.id_sucursal_despacho, hro.casilleros_ocupados, hro.kilos_asignados
     FROM hoja_de_ruta_ordenes hro
     JOIN ordenes_entrega oe ON oe.id_orden_entrega = hro.id_orden_entrega
     JOIN clientes cl ON cl.id_cliente = oe.cliente_id
     WHERE hro.id_hoja_de_ruta = $1
     ORDER BY hro.agregado_en`,
    [id_hoja_de_ruta],
  );
  return rows.map((r) => ({
    id_hoja_de_ruta_orden: r.id_hoja_de_ruta_orden,
    id_hoja_de_ruta: r.id_hoja_de_ruta,
    id_orden_entrega: r.id_orden_entrega,
    nro_orden: r.nro_orden,
    cliente: r.cliente,
    id_sucursal_despacho: r.id_sucursal_despacho,
    casillerosOcupados: r.casilleros_ocupados,
    kilosAsignados: Number(r.kilos_asignados),
  }));
}

async function conOrdenes(client: Queryable, hoja: HojaDeRuta): Promise<HojaDeRuta> {
  hoja.ordenes = await obtenerOrdenesDeHoja(client, hoja.id_hoja_de_ruta);
  return hoja;
}

export async function crearHojaDeRuta(input: CrearHojaDeRutaInput, contexto: { id_usuario: number }): Promise<HojaDeRuta> {
  if (!Number.isInteger(input.id_camion) || input.id_camion <= 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_camion es requerido y debe ser un entero positivo.');
  }
  if (!FECHA_REGEX.test(input.fecha_despacho ?? '')) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'fecha_despacho es requerida con formato YYYY-MM-DD.');
  }

  const { rows: camionRows } = await pool.query<{ id_camion: number }>(`SELECT id_camion FROM camiones WHERE id_camion = $1`, [
    input.id_camion,
  ]);
  if (!camionRows[0]) {
    throw AppError.notFound('CAMION_NO_ENCONTRADO', `No existe el camión id_camion=${input.id_camion}`);
  }

  const { rows } = await pool.query<HojaDeRuta>(
    `INSERT INTO hojas_de_ruta (id_camion, chofer, fecha_despacho, id_usuario_creo)
     VALUES ($1, $2, $3, $4)
     RETURNING ${HOJA_DE_RUTA_COLUMNAS}`,
    [input.id_camion, input.chofer ?? null, input.fecha_despacho, contexto.id_usuario],
  );
  const hoja = rows[0];
  hoja.ordenes = [];
  return hoja;
}

/**
 * Listado liviano de Hojas de Ruta recientes (sin el detalle de órdenes),
 * para poder retomar una hoja en `BORRADOR` después de recargar la Pizarra
 * — hasta este incremento, la pantalla sólo podía trabajar con la hoja
 * creada en la misma sesión del navegador.
 */
export async function listarHojasDeRuta(): Promise<HojaDeRutaResumen[]> {
  const { rows } = await pool.query<{
    id_hoja_de_ruta: number;
    id_camion: number;
    patente: string;
    chofer: string | null;
    fecha_despacho: string;
    estado: string;
    nro_cot: string | null;
    cantidad_ordenes: string;
  }>(
    `SELECT hr.id_hoja_de_ruta, hr.id_camion, c.patente, hr.chofer, hr.fecha_despacho, hr.estado, hr.nro_cot,
            COUNT(hro.id_hoja_de_ruta_orden) AS cantidad_ordenes
     FROM hojas_de_ruta hr
     JOIN camiones c ON c.id_camion = hr.id_camion
     LEFT JOIN hoja_de_ruta_ordenes hro ON hro.id_hoja_de_ruta = hr.id_hoja_de_ruta
     GROUP BY hr.id_hoja_de_ruta, c.patente
     ORDER BY hr.fecha_creacion DESC
     LIMIT 50`,
  );

  return rows.map((r) => ({
    id_hoja_de_ruta: r.id_hoja_de_ruta,
    id_camion: r.id_camion,
    patente: r.patente,
    chofer: r.chofer,
    fecha_despacho: r.fecha_despacho,
    estado: r.estado as HojaDeRutaResumen['estado'],
    nro_cot: r.nro_cot,
    cantidadOrdenes: Number(r.cantidad_ordenes),
  }));
}

export async function obtenerHojaDeRuta(id_hoja_de_ruta: number): Promise<HojaDeRuta> {
  const { rows } = await pool.query<HojaDeRuta>(`SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1`, [
    id_hoja_de_ruta,
  ]);
  const hoja = rows[0];
  if (!hoja) {
    throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
  }
  return conOrdenes(pool, hoja);
}

/**
 * Backlog de la Pizarra de Camiones: Órdenes de Entrega Pendientes con
 * `tipo_entrega = 'ENVIO_DOMICILIO'` que todavía no están en ninguna Hoja
 * de Ruta activa. Las de `RETIRO_CLIENTE` no aparecen acá — esas se
 * retiran en mostrador (`ordenesEntrega.routes.ts`), no por camión.
 */
export async function listarBacklogOrdenesPendientes(contexto: ContextoAcceso): Promise<OrdenEntregaBacklog[]> {
  const condicionSucursal = contexto.rol === 'VENDEDOR' ? 'AND oe.id_sucursal_origen = $1' : '';
  const valores = contexto.rol === 'VENDEDOR' ? [contexto.id_sucursal] : [];

  const { rows } = await pool.query<{
    id_orden_entrega: number;
    nro_orden: string | null;
    cliente: string;
    zona: string | null;
    casilleros_requeridos: number | null;
    kilos_totales: string;
    direccion_envio: string | null;
    fecha_pactada_envio: string | null;
  }>(
    `SELECT oe.id_orden_entrega, oe.nro_orden, cl.nombre AS cliente, z.nombre AS zona, z.casilleros_requeridos,
            oe.direccion_envio, oe.fecha_pactada_envio,
            COALESCE((SELECT SUM(oed.cantidad * p.peso_teorico_kg) FROM ordenes_entrega_detalles oed
                      JOIN productos p ON p.id_producto = oed.id_producto
                      WHERE oed.id_orden_entrega = oe.id_orden_entrega), 0) AS kilos_totales
     FROM ordenes_entrega oe
     JOIN clientes cl ON cl.id_cliente = oe.cliente_id
     JOIN documentos d ON d.id_documento = oe.id_documento
     LEFT JOIN zonas z ON z.id_zona = d.id_zona
     WHERE oe.estado = 'PENDIENTE'
       AND oe.tipo_entrega = 'ENVIO_DOMICILIO'
       AND NOT EXISTS (
         SELECT 1 FROM hoja_de_ruta_ordenes hro
         JOIN hojas_de_ruta hr ON hr.id_hoja_de_ruta = hro.id_hoja_de_ruta
         WHERE hro.id_orden_entrega = oe.id_orden_entrega AND hr.estado != 'ANULADA'
       )
       ${condicionSucursal}
     ORDER BY oe.fecha_pactada_envio NULLS LAST, oe.fecha_creacion DESC
     LIMIT 100`,
    valores,
  );

  return rows.map((r) => ({
    id_orden_entrega: r.id_orden_entrega,
    nro_orden: r.nro_orden,
    cliente: r.cliente,
    zona: r.zona,
    casillerosRequeridos: r.casilleros_requeridos,
    kilosTotales: redondearMoneda(Number(r.kilos_totales)),
    direccion_envio: r.direccion_envio,
    fecha_pactada_envio: r.fecha_pactada_envio,
  }));
}

/**
 * Agrega una Orden de Entrega Pendiente a una Hoja de Ruta en `BORRADOR`,
 * validando capacidad de kilos/casilleros del camión (mismo criterio que
 * `logistica.service.ts::asignarEnvio`) contra lo YA asignado a ese viaje.
 * No toca stock — eso sólo pasa al confirmar la salida.
 */
export async function agregarOrdenAHoja(
  id_hoja_de_ruta: number,
  input: AgregarOrdenAHojaInput,
  contexto: ContextoAcceso,
): Promise<HojaDeRuta> {
  if (!input.nro_orden?.trim()) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'nro_orden es requerido.');
  }
  if (!Number.isInteger(input.id_sucursal_despacho)) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'id_sucursal_despacho es requerido y debe ser un entero.');
  }
  verificarAccesoSucursal(contexto, input.id_sucursal_despacho);

  return withTransaction(async (client) => {
    const { rows: hojaRows } = await client.query<HojaDeRuta>(
      `SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1 FOR UPDATE`,
      [id_hoja_de_ruta],
    );
    const hoja = hojaRows[0];
    if (!hoja) {
      throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
    }
    if (hoja.estado !== 'BORRADOR') {
      throw AppError.badRequest('HOJA_NO_EDITABLE', 'Sólo se pueden agregar órdenes a una hoja de ruta en borrador.');
    }

    const { rows: camionRows } = await client.query<Camion>(
      `SELECT id_camion, patente, chofer, capacidad_casilleros, capacidad_kilos_max FROM camiones WHERE id_camion = $1 FOR UPDATE`,
      [hoja.id_camion],
    );
    const camion = camionRows[0];

    const { rows: ordenRows } = await client.query<{
      id_orden_entrega: number;
      id_documento: number;
      estado: string;
      tipo_entrega: string;
    }>(`SELECT id_orden_entrega, id_documento, estado, tipo_entrega FROM ordenes_entrega WHERE nro_orden = $1 FOR UPDATE`, [
      input.nro_orden,
    ]);
    const orden = ordenRows[0];
    if (!orden) {
      throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega ${input.nro_orden}`);
    }
    if (orden.estado !== 'PENDIENTE') {
      throw AppError.conflict('ORDEN_NO_DISPONIBLE', `La orden ${input.nro_orden} ya no está pendiente.`);
    }
    // Paradigma de la Pizarra de Camiones: un camión transporta mercadería
    // física pendiente de ENVÍO, no facturas. Una orden de retiro en
    // mostrador nunca sube a un viaje — primero hay que editarla a
    // ENVIO_DOMICILIO (`editarTipoEntregaOrden`).
    if (orden.tipo_entrega !== 'ENVIO_DOMICILIO') {
      throw AppError.badRequest(
        'ORDEN_NO_ES_ENVIO_DOMICILIO',
        `La orden ${input.nro_orden} es de retiro en mostrador, no de envío a domicilio; no puede subirse a un camión.`,
      );
    }

    const { rows: yaAsignadaRows } = await client.query<{ id_hoja_de_ruta: number }>(
      `SELECT hro.id_hoja_de_ruta FROM hoja_de_ruta_ordenes hro
       JOIN hojas_de_ruta hr ON hr.id_hoja_de_ruta = hro.id_hoja_de_ruta
       WHERE hro.id_orden_entrega = $1 AND hr.estado != 'ANULADA'`,
      [orden.id_orden_entrega],
    );
    if (yaAsignadaRows[0]) {
      throw AppError.conflict('ORDEN_YA_ASIGNADA', `La orden ${input.nro_orden} ya está asignada a otro viaje.`);
    }

    const { rows: documentoRows } = await client.query<{ id_zona: number | null }>(
      `SELECT id_zona FROM documentos WHERE id_documento = $1`,
      [orden.id_documento],
    );
    const documento = documentoRows[0];
    if (!documento?.id_zona) {
      throw AppError.badRequest(
        'CLIENTE_SIN_ZONA',
        'El cliente de esta orden no tiene zona asignada; no se puede calcular cuántos casilleros ocupa.',
      );
    }

    const { rows: zonaRows } = await client.query<Zona>(`SELECT id_zona, nombre, casilleros_requeridos FROM zonas WHERE id_zona = $1`, [
      documento.id_zona,
    ]);
    const zona = zonaRows[0];
    if (!zona) {
      throw AppError.badRequest('ZONA_INVALIDA', 'La zona asignada al cliente ya no existe.');
    }

    const { rows: kilosRows } = await client.query<{ kilos_totales: string }>(
      `SELECT COALESCE(SUM(oed.cantidad * p.peso_teorico_kg), 0) AS kilos_totales
       FROM ordenes_entrega_detalles oed
       JOIN productos p ON p.id_producto = oed.id_producto
       WHERE oed.id_orden_entrega = $1`,
      [orden.id_orden_entrega],
    );
    const kilosTotales = redondearMoneda(Number(kilosRows[0].kilos_totales));
    // `hoja_de_ruta_ordenes.kilos_asignados` exige > 0 (CHECK): un producto
    // sin `peso_teorico_kg` cargado da 0 acá, lo que violaría ese CHECK con
    // un 500 genérico de Postgres en vez de este 400 explícito.
    if (kilosTotales <= 0) {
      throw AppError.badRequest(
        'ORDEN_SIN_PESO',
        `La orden ${input.nro_orden} no tiene un peso calculable: algún producto no tiene peso_teorico_kg cargado. Cargalo en Gestión de Productos antes de subir la orden a un camión.`,
      );
    }

    const { rows: ocupacionRows } = await client.query<{ casilleros_usados: string; kilos_usados: string }>(
      `SELECT COALESCE(SUM(casilleros_ocupados), 0) AS casilleros_usados, COALESCE(SUM(kilos_asignados), 0) AS kilos_usados
       FROM hoja_de_ruta_ordenes WHERE id_hoja_de_ruta = $1`,
      [id_hoja_de_ruta],
    );
    const casillerosUsados = Number(ocupacionRows[0].casilleros_usados);
    const kilosUsados = Number(ocupacionRows[0].kilos_usados);

    const kilosDisponibles = redondearMoneda(Number(camion.capacidad_kilos_max) - kilosUsados);
    if (kilosTotales > kilosDisponibles) {
      throw AppError.conflict(
        'CAPACIDAD_KILOS_EXCEDIDA',
        `El camión ${camion.patente} sólo tiene ${kilosDisponibles} kg disponibles en este viaje y la orden pesa ${kilosTotales} kg.`,
      );
    }
    const casillerosDisponibles = camion.capacidad_casilleros - casillerosUsados;
    if (zona.casilleros_requeridos > casillerosDisponibles) {
      throw AppError.conflict(
        'CAPACIDAD_CASILLEROS_EXCEDIDA',
        `El camión ${camion.patente} sólo tiene ${casillerosDisponibles} casilleros disponibles en este viaje y la zona "${zona.nombre}" requiere ${zona.casilleros_requeridos}.`,
      );
    }

    await client.query(
      `INSERT INTO hoja_de_ruta_ordenes (id_hoja_de_ruta, id_orden_entrega, id_sucursal_despacho, casilleros_ocupados, kilos_asignados)
       VALUES ($1, $2, $3, $4, $5)`,
      [id_hoja_de_ruta, orden.id_orden_entrega, input.id_sucursal_despacho, zona.casilleros_requeridos, kilosTotales],
    );

    return conOrdenes(client, hoja);
  });
}

export async function quitarOrdenDeHoja(id_hoja_de_ruta: number, id_orden_entrega: number): Promise<HojaDeRuta> {
  return withTransaction(async (client) => {
    const { rows: hojaRows } = await client.query<HojaDeRuta>(
      `SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1 FOR UPDATE`,
      [id_hoja_de_ruta],
    );
    const hoja = hojaRows[0];
    if (!hoja) {
      throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
    }
    if (hoja.estado !== 'BORRADOR') {
      throw AppError.badRequest('HOJA_NO_EDITABLE', 'Sólo se pueden quitar órdenes de una hoja de ruta en borrador.');
    }

    const { rows: relRows } = await client.query<{ id_hoja_de_ruta_orden: number }>(
      `SELECT id_hoja_de_ruta_orden FROM hoja_de_ruta_ordenes WHERE id_hoja_de_ruta = $1 AND id_orden_entrega = $2`,
      [id_hoja_de_ruta, id_orden_entrega],
    );
    const relacion = relRows[0];
    if (!relacion) {
      throw AppError.notFound('ORDEN_NO_ESTA_EN_LA_HOJA', 'Esa orden no está en esta hoja de ruta.');
    }
    await client.query(`DELETE FROM hoja_de_ruta_ordenes WHERE id_hoja_de_ruta_orden = $1`, [relacion.id_hoja_de_ruta_orden]);

    return conOrdenes(client, hoja);
  });
}

export async function anularHojaDeRuta(
  id_hoja_de_ruta: number,
  contexto: { id_usuario: number },
  input: AnularHojaDeRutaInput,
): Promise<HojaDeRuta> {
  if (!input.motivo || !input.motivo.trim()) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'motivo es requerido para anular una hoja de ruta.');
  }

  return withTransaction(async (client) => {
    const { rows: hojaRows } = await client.query<HojaDeRuta>(
      `SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1 FOR UPDATE`,
      [id_hoja_de_ruta],
    );
    const hoja = hojaRows[0];
    if (!hoja) {
      throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
    }
    if (hoja.estado === 'EN_TRANSITO') {
      throw AppError.badRequest('HOJA_YA_EN_TRANSITO', 'Esta hoja de ruta ya salió; no se puede anular.');
    }
    if (hoja.estado === 'ANULADA') {
      throw AppError.badRequest('HOJA_YA_ANULADA', 'Esta hoja de ruta ya está anulada.');
    }

    const { rows: actualizadaRows } = await client.query<HojaDeRuta>(
      `UPDATE hojas_de_ruta SET estado = 'ANULADA', motivo_anulacion = $1, id_usuario_anulo = $2, fecha_anulacion = NOW()
       WHERE id_hoja_de_ruta = $3
       RETURNING ${HOJA_DE_RUTA_COLUMNAS}`,
      [input.motivo, contexto.id_usuario, id_hoja_de_ruta],
    );
    return conOrdenes(client, actualizadaRows[0]);
  });
}

/**
 * Confirma la salida del camión: procesa TODAS las órdenes del viaje en una
 * única transacción — libera reserva + descuenta stock físico + emite
 * remito por cada una (`cumplirOrdenEntrega`, reutilizado de
 * `ordenesEntrega.service.ts`). Si cualquier orden ya no está `PENDIENTE`
 * (alguien la anuló por mostrador mientras se armaba el viaje), la
 * transacción entera se revierte — ninguna orden del viaje se despacha a
 * medias.
 */
export async function confirmarSalidaHojaDeRuta(id_hoja_de_ruta: number, contexto: { id_usuario: number }): Promise<HojaDeRuta> {
  return withTransaction(async (client) => {
    const { rows: hojaRows } = await client.query<HojaDeRuta>(
      `SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1 FOR UPDATE`,
      [id_hoja_de_ruta],
    );
    const hoja = hojaRows[0];
    if (!hoja) {
      throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
    }
    if (hoja.estado === 'EN_TRANSITO') {
      throw AppError.badRequest('HOJA_YA_EN_TRANSITO', 'Esta hoja de ruta ya fue confirmada.');
    }
    if (hoja.estado === 'ANULADA') {
      throw AppError.badRequest('HOJA_ANULADA', 'Esta hoja de ruta está anulada.');
    }
    if (!hoja.nro_cot?.trim()) {
      throw AppError.badRequest(
        'COT_REQUERIDO',
        'Esta hoja de ruta necesita un Código de Operación de Traslado (COT) cargado antes de confirmar la salida.',
      );
    }

    const { rows: relacionesRows } = await client.query<{ id_orden_entrega: number; id_sucursal_despacho: number }>(
      `SELECT id_orden_entrega, id_sucursal_despacho FROM hoja_de_ruta_ordenes WHERE id_hoja_de_ruta = $1`,
      [id_hoja_de_ruta],
    );
    if (relacionesRows.length === 0) {
      throw AppError.badRequest('HOJA_SIN_ORDENES', 'La hoja de ruta no tiene ninguna orden asignada.');
    }

    for (const relacion of relacionesRows) {
      const orden = await bloquearOrdenEntregaPorId(client, relacion.id_orden_entrega);
      if (!orden) {
        throw AppError.notFound('ORDEN_ENTREGA_NO_ENCONTRADA', `No existe la orden de entrega id_orden_entrega=${relacion.id_orden_entrega}`);
      }
      if (orden.estado !== 'PENDIENTE') {
        throw AppError.conflict(
          'ORDEN_ENTREGA_NO_PENDIENTE',
          `La orden ${orden.nro_orden} ya no está pendiente (fue retirada o anulada por otra vía); no se puede confirmar la salida de este viaje.`,
        );
      }

      const { rows: documentoRows } = await client.query<{ id_documento: number; cliente_id: number; es_fiscal: boolean }>(
        `SELECT id_documento, cliente_id, es_fiscal FROM documentos WHERE id_documento = $1 FOR UPDATE`,
        [orden.id_documento],
      );
      const documento = documentoRows[0];
      const detalles = await obtenerDetallesOrdenEntrega(client, orden.id_orden_entrega);

      await cumplirOrdenEntrega(client, {
        orden,
        documento,
        detalles,
        idSucursalDespacho: relacion.id_sucursal_despacho,
        idUsuario: contexto.id_usuario,
        idCamion: hoja.id_camion,
        idChofer: hoja.chofer,
      });
    }

    const { rows: actualizadaRows } = await client.query<HojaDeRuta>(
      `UPDATE hojas_de_ruta SET estado = 'EN_TRANSITO', id_usuario_confirmo = $1, fecha_confirmacion = NOW()
       WHERE id_hoja_de_ruta = $2
       RETURNING ${HOJA_DE_RUTA_COLUMNAS}`,
      [contexto.id_usuario, id_hoja_de_ruta],
    );
    return conOrdenes(client, actualizadaRows[0]);
  });
}

/**
 * Carga el Código de Operación de Traslado (COT, exigido por ARBA) del
 * viaje completo — una Hoja de Ruta puede agrupar varias Órdenes de Entrega
 * (varios remitos) en un mismo camión, así que el COT se carga una única
 * vez por viaje, no por remito. Sólo mientras la hoja está en `BORRADOR`:
 * `confirmarSalidaHojaDeRuta` exige que ya esté cargado antes de despachar.
 * No afecta stock ni la asignación de órdenes, así que no hace falta
 * transacción ni bloquear filas (mismo criterio que `actualizarCotEnvio`).
 */
export async function actualizarCotHojaDeRuta(id_hoja_de_ruta: number, input: ActualizarCotInput): Promise<HojaDeRuta> {
  const nroCot = input.nro_cot?.trim() ?? '';
  if (!nroCot) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'nro_cot es requerido.');
  }

  const { rows: hojaRows } = await pool.query<HojaDeRuta>(
    `SELECT ${HOJA_DE_RUTA_COLUMNAS} FROM hojas_de_ruta WHERE id_hoja_de_ruta = $1`,
    [id_hoja_de_ruta],
  );
  const hoja = hojaRows[0];
  if (!hoja) {
    throw AppError.notFound('HOJA_DE_RUTA_NO_ENCONTRADA', `No existe la hoja de ruta id_hoja_de_ruta=${id_hoja_de_ruta}`);
  }
  if (hoja.estado !== 'BORRADOR') {
    throw AppError.badRequest('HOJA_NO_EDITABLE', 'El COT sólo se puede cargar mientras la hoja de ruta está en borrador.');
  }

  const { rows: actualizadaRows } = await pool.query<HojaDeRuta>(
    `UPDATE hojas_de_ruta SET nro_cot = $1 WHERE id_hoja_de_ruta = $2 RETURNING ${HOJA_DE_RUTA_COLUMNAS}`,
    [nroCot, id_hoja_de_ruta],
  );
  return conOrdenes(pool, actualizadaRows[0]);
}
