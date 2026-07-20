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

/** Identidad atada a la sesión del usuario logueado (sucursal + rol). */
export interface SesionUsuario {
  id_sucursal: number;
  rol: Rol;
  vendedor: string;
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
}
