/**
 * Tipos de dominio que reflejan el modelo de datos de PostgreSQL.
 * Mantener sincronizado con `sql/001_extend_schema.sql`.
 */

export type Rol = 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR';

export type TipoDocumento = 'PRESUPUESTO' | 'FACTURA_A' | 'FACTURA_B';

export interface Sucursal {
  id_sucursal: number;
  nombre: string;
}

export interface Cliente {
  id_cliente: number;
  nombre: string;
  cuit_dni: string;
  limite_credito: string; // NUMERIC llega como string desde pg
  id_zona: number | null;
}

export interface CuentaEmpresa {
  id_cuenta: number;
  nombre_cuenta: string;
}

export interface SucursalSecuencia {
  id_sucursal: number;
  tipo_documento: TipoDocumento;
  ultimo_numero: number;
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
  id_zona: number | null;
}

export interface MovimientoCuentaCorriente {
  id_movimiento: number;
  cliente_id: number;
  fecha: string;
  debe: string;
  haber: string;
  id_documento: number | null;
  id_cuenta: number | null;
  concepto: string | null;
}

/**
 * Payload del JWT de sesión. `id_sucursal` viaja firmado en el token (no lo
 * elige el cliente en cada request) para que ningún vendedor pueda facturar
 * a nombre de otra sucursal manipulando el payload de la request.
 */
export interface UserPayload {
  id_usuario: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  id_sucursal: number;
}

/** Fila de la tabla `usuarios`. `password_hash`/`pin_autorizacion_hash` nunca viajan al frontend. */
export interface Usuario {
  id_usuario: number;
  nombre: string;
  usuario: string;
  password_hash: string;
  pin_autorizacion_hash: string | null;
  rol: Rol;
  id_sucursal: number | null;
  activo: boolean;
}

export interface AuditoriaAutorizacion {
  id_autorizacion: number;
  id_usuario_vendedor: number;
  id_supervisor: number;
  id_cliente: number;
  monto_excedido: string;
  fecha: string;
}

// -----------------------------------------------------------------------
// Payloads de la API
// -----------------------------------------------------------------------

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
  capacidad_kilos_max: string; // NUMERIC llega como string desde pg
}

/** Un remito ya asignado a un camión, tal como se muestra en la grilla de ruteo. */
export interface EnvioAsignado {
  id_envio: number;
  id_documento: number;
  nro_remito: number | null;
  cliente: string;
  zona: string;
  casillerosRequeridos: number;
  kilosTotales: number;
}

/** Ocupación de un camión para una fecha de despacho puntual. */
export interface CamionJornada {
  id_camion: number;
  chofer: string;
  patente: string;
  capacidadCasilleros: number;
  capacidadKilosMax: number;
  envios: EnvioAsignado[];
}

/** Un remito facturado que todavía no fue asignado a ningún camión. */
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
  fecha_despacho: string; // 'YYYY-MM-DD'
}
