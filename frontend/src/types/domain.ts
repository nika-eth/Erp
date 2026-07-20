/**
 * Tipos de dominio del frontend, en espejo con `backend/src/types/domain.ts`.
 * Al no compartir un paquete común entre backend y frontend en este núcleo,
 * se duplican intencionalmente; mantenerlos sincronizados a mano.
 */

export type Rol = 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR';

export type TipoDocumento = 'PRESUPUESTO' | 'FACTURA_A' | 'FACTURA_B';

export type EstadoAfip = 'PENDIENTE' | 'APROBADO' | 'CONTINGENCIA' | 'RECHAZADO' | 'APROBADO_INTERNO';

export interface Sucursal {
  id_sucursal: number;
  nombre: string;
}

export interface Cliente {
  id_cliente: number;
  nombre: string;
  cuit_dni: string;
  limite_credito: string;
}

export interface CuentaEmpresa {
  id_cuenta: number;
  nombre_cuenta: string;
}

export interface MaterialCatalogo {
  id_material: string;
  descripcion: string;
  unidad: 'metro' | 'unidad';
  peso_teorico_kg: number;
}

export interface ItemDocumento {
  id_material: string;
  descripcion: string;
  cantidad: number;
  peso_teorico_kg: number;
  kilos: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Documento {
  id_documento: number;
  id_sucursal_origen: number;
  nro_remito: number | null;
  fecha: string;
  cliente_id: number;
  total_neto: string;
  tipo_documento: TipoDocumento;
  items: ItemDocumento[];
  cliente_nombre?: string;
  sucursal_nombre?: string;
  es_fiscal: boolean;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  nro_comprobante_afip: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  estado_afip: EstadoAfip | null;
  error_afip_mensaje: string | null;
}

export interface MovimientoCuentaCorriente {
  id_movimiento: number;
  cliente_id: number;
  fecha: string;
  debe: string;
  haber: string;
  id_documento: number | null;
  id_cuenta: number | null;
  id_recibo: number | null;
  concepto: string | null;
  saldo: string;
}

export interface ResumenClienteCuentaCorriente {
  id_cliente: number;
  nombre: string;
  cuit_dni: string;
  limite_credito: string;
}

export interface FichaCuentaCorriente {
  cliente: ResumenClienteCuentaCorriente;
  movimientos: MovimientoCuentaCorriente[];
  saldo_total: string;
}

/** Payload del JWT: `id_sucursal` viaja firmado, no lo elige quien loguea. */
export interface UserPayload {
  id_usuario: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  id_sucursal: number;
}

export interface PagoInput {
  id_cuenta: number;
  monto: number;
}

export interface ItemInput {
  id_material: string;
  descripcion: string;
  cantidad: number;
  peso_teorico_kg: number;
  precio_unitario: number;
}

export interface FacturarVentaInput {
  cliente_id: number;
  items: ItemInput[];
  total_neto: number;
  pagos: PagoInput[];
  /** F5 (fiscal, default) vs F6 (interno) en Rendición de Pago. */
  es_fiscal?: boolean;
}

export interface FacturarVentaResult {
  documento: Documento;
  saldo_pendiente: number;
  movimientos: MovimientoCuentaCorriente[];
  autorizacion?: { supervisor: string; monto_excedido: number };
}

// -----------------------------------------------------------------------
// Logística y despacho de camiones
// -----------------------------------------------------------------------

export interface Zona {
  id_zona: number;
  nombre: string;
  casilleros_requeridos: number;
}

export interface Camion {
  id_camion: number;
  patente: string;
  chofer: string;
  capacidad_casilleros: number;
  capacidad_kilos_max: string;
}

export interface EnvioAsignado {
  id_envio: number;
  id_documento: number;
  nro_remito: number | null;
  cliente: string;
  zona: string;
  casillerosRequeridos: number;
  kilosTotales: number;
}

export interface CamionJornada {
  id_camion: number;
  chofer: string;
  patente: string;
  capacidadCasilleros: number;
  capacidadKilosMax: number;
  envios: EnvioAsignado[];
}

export interface DocumentoPendiente {
  id_documento: number;
  nro_remito: number | null;
  cliente: string;
  zona: string | null;
  casillerosRequeridos: number | null;
  kilosTotales: number;
}

export interface AsignarEnvioInput {
  id_camion: number;
  id_documento: number;
  fecha_despacho: string;
}

// -----------------------------------------------------------------------
// Recibos de cobranza
// -----------------------------------------------------------------------

export interface Recibo {
  id_recibo: number;
  nro_recibo: number | null;
  cliente_id: number;
  id_sucursal: number;
  fecha: string;
  monto_total: string;
  id_usuario: number;
}

export interface DetallePagoRecibo {
  id_detalle: number;
  id_recibo: number;
  id_cuenta: number;
  monto: string;
  nro_comprobante: string | null;
}

export interface PagoReciboInput {
  id_cuenta: number;
  monto: number;
  nro_comprobante?: string;
}

export interface EmitirReciboInput {
  cliente_id: number;
  pagos: PagoReciboInput[];
}

export interface EmitirReciboResult {
  recibo: Recibo;
  detalles: DetallePagoRecibo[];
  movimientos: MovimientoCuentaCorriente[];
  saldo_actual: number;
}

// -----------------------------------------------------------------------
// Integración AFIP y cola de contingencia
// -----------------------------------------------------------------------

/** Resumen para el indicador global del Header. */
export interface EstadoServicioAfip {
  online: boolean;
  tareas_pendientes: number;
  tareas_falladas: number;
  ultima_contingencia: string | null;
}
