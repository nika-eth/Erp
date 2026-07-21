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

export type TipoDocumentoCliente = 'DNI' | 'CUIT';

/** Regla AFIP: DNI sólo puede ser CONSUMIDOR_FINAL; CUIT nunca puede serlo. */
export type CondicionIva = 'CONSUMIDOR_FINAL' | 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';

export interface Cliente {
  id_cliente: number;
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIva;
  limite_credito: string;
  id_zona: number | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface CrearClienteInput {
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIva;
  limite_credito?: number;
  id_zona?: number | null;
  direccion?: string;
  telefono?: string;
  email?: string;
}

export interface CuentaEmpresa {
  id_cuenta: number;
  nombre_cuenta: string;
}

/**
 * KILO   -> subtotal = (cantidad * peso_teorico_kg) * precio_unitario ($/kg)
 * UNIDAD -> subtotal = cantidad * precio_unitario ($/unidad)
 */
export type UnidadVentaProducto = 'KILO' | 'UNIDAD';

export interface Producto {
  id_producto: number;
  sku: string;
  descripcion: string;
  unidad_venta: UnidadVentaProducto;
  peso_teorico_kg: string;
  activo: boolean;
}

/** Edición de producto (Gestión de Productos, F7). `sku` no se puede editar. */
export interface ActualizarProductoInput {
  descripcion?: string;
  unidad_venta?: UnidadVentaProducto;
  peso_teorico_kg?: number;
  activo?: boolean;
}

export interface ItemDocumento {
  id_producto: number;
  sku: string;
  descripcion: string;
  unidad_venta: UnidadVentaProducto;
  cantidad: number;
  peso_teorico_kg: number;
  kilos: number;
  precio_unitario: number;
  subtotal: number;
  /** Suma de `remitos_detalles.cantidad_despachada` ya remitidos para este ítem. */
  cantidad_despachada_total: number;
}

export type EstadoDespachoDocumento = 'PENDIENTE' | 'DESPACHADO_PARCIAL' | 'DESPACHADO_TOTAL';

/** Sólo aplica a documentos con `es_fiscal:false` (Comprobantes Internos); `null` en los fiscales. */
export type EstadoFacturacionInterna = 'PENDIENTE' | 'FACTURADA';

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
  id_documento_origen_ci: number | null;
  estado_facturacion_interna: EstadoFacturacionInterna | null;
  estado_despacho: EstadoDespachoDocumento;
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
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
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

/** Lo mínimo que viaja al backend por ítem: el resto (descripción, unidad_venta, peso) se resuelve server-side contra `productos`. */
/** Modo en que se cargó `cantidad`: conteo de unidades o kilos a convertir (ver `resolverCantidadUnidades` en el backend). Default 'U' si no viene. */
export type UnidadIngresoCantidad = 'U' | 'KG';

export interface ItemInput {
  id_producto: number;
  /** Tal como lo tipeó el vendedor: unidades si `unidad_ingreso` es 'U', kilos si es 'KG'. */
  cantidad: number;
  unidad_ingreso?: UnidadIngresoCantidad;
  precio_unitario: number;
}

/** Ítem en el carrito de Carga Unificada, con los datos del producto ya resueltos para mostrar en pantalla antes de facturar. */
export interface ItemCarrito extends ItemInput {
  sku: string;
  descripcion: string;
  unidad_venta: UnidadVentaProducto;
  peso_teorico_kg: number;
  /** Cantidad ya resuelta a unidades enteras (calculada localmente, mismo cálculo que hará el backend) — la que se muestra en la grilla del carrito. */
  cantidadUnidades: number;
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
  /** Código de Operación de Traslado (ARBA), cargado desde Control de Ruteo. */
  nro_cot: string | null;
}

export interface ActualizarCotInput {
  nro_cot: string;
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

// -----------------------------------------------------------------------
// Remitos de entrega
// -----------------------------------------------------------------------

/** 'R' = Fiscal (documento origen es_fiscal:true), 'X' = Interno (Comprobante Interno). */
export type TipoRemito = 'R' | 'X';

export type EstadoRemito = 'EMITIDO' | 'EN_TRANSITO' | 'ENTREGADO' | 'ANULADO';

export interface RemitoDetalle {
  id_remito_detalle: number;
  id_producto: number;
  sku: string;
  descripcion: string;
  cantidad_despachada: number;
}

export interface Remito {
  id_remito: number;
  nro_remito: string | null;
  id_documento_origen: number;
  tipo_remito: TipoRemito;
  id_remito_origen_x: number | null;
  es_regularizacion_stock: boolean;
  estado: EstadoRemito;
  cliente_id: number;
  id_sucursal: number;
  id_camion: number | null;
  id_chofer: string | null;
  fecha_emision: string;
  motivo_anulacion: string | null;
  id_usuario_anulo: number | null;
  fecha_anulacion: string | null;
  detalles: RemitoDetalle[];
}

export interface GenerarRemitoInput {
  id_documento: number;
  items: Array<{ id_producto: number; cantidad: number; unidad_ingreso?: UnidadIngresoCantidad }>;
  id_camion?: number | null;
  id_chofer?: string | null;
}

export interface AnularRemitoInput {
  motivo: string;
}

export interface FacturarComprobanteInternoResult {
  documento: Documento;
  remitos_regularizacion: Remito[];
}

// -----------------------------------------------------------------------
// Cuentas por Pagar (ver backend/sql/012_cuentas_por_pagar.sql)
// -----------------------------------------------------------------------

export type MonedaSoportada = 'ARS' | 'USD';

/** Sin CONSUMIDOR_FINAL: no aplica a un proveedor. */
export type CondicionIvaProveedor = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';

export interface Proveedor {
  id_proveedor: number;
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIvaProveedor;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
}

export interface CrearProveedorInput {
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIvaProveedor;
  direccion?: string;
  telefono?: string;
  email?: string;
}

export interface ActualizarProveedorInput {
  nombre?: string;
  condicion_iva?: CondicionIvaProveedor;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
  activo?: boolean;
}

export type EstadoFacturaProveedor = 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'ANULADA';

export interface FacturaProveedor {
  id_factura_proveedor: number;
  id_proveedor: number;
  tipo_comprobante: string;
  punto_venta: number;
  nro_comprobante: number;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  moneda: MonedaSoportada;
  cotizacion: string;
  importe_neto: string;
  importe_iva: string;
  importe_total: string;
  saldo_pendiente: string;
  estado: EstadoFacturaProveedor;
}

export interface CrearFacturaProveedorInput {
  id_proveedor: number;
  tipo_comprobante: string;
  punto_venta: number;
  nro_comprobante: number;
  fecha_emision: string;
  fecha_vencimiento?: string;
  moneda?: MonedaSoportada;
  cotizacion?: number;
  importe_neto: number;
  importe_iva?: number;
}

export type EstadoNotaCreditoProveedor = 'DISPONIBLE' | 'PARCIAL' | 'APLICADA' | 'ANULADA';

export interface NotaCreditoProveedor {
  id_nota_credito_proveedor: number;
  id_proveedor: number;
  id_factura_proveedor: number | null;
  tipo_comprobante: string;
  punto_venta: number;
  nro_comprobante: number;
  fecha_emision: string;
  moneda: MonedaSoportada;
  cotizacion: string;
  importe_total: string;
  saldo_disponible: string;
  estado: EstadoNotaCreditoProveedor;
}

export interface CrearNotaCreditoProveedorInput {
  id_proveedor: number;
  id_factura_proveedor?: number | null;
  tipo_comprobante: string;
  punto_venta: number;
  nro_comprobante: number;
  fecha_emision: string;
  moneda?: MonedaSoportada;
  cotizacion?: number;
  importe_total: number;
}
