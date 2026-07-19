/**
 * Tipos de dominio del frontend, en espejo con `backend/src/types/domain.ts`.
 * Al no compartir un paquete común entre backend y frontend en este núcleo,
 * se duplican intencionalmente; mantenerlos sincronizados a mano.
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
  saldo: string;
}

export interface FichaCuentaCorriente {
  cliente_id: number;
  movimientos: MovimientoCuentaCorriente[];
  saldo_total: string;
}

export interface SesionUsuario {
  id_sucursal: number;
  rol: Rol;
  vendedor: string;
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
}

export interface FacturarVentaResult {
  documento: Documento;
  saldo_pendiente: number;
  movimientos: MovimientoCuentaCorriente[];
}
