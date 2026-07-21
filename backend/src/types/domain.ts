/**
 * Tipos de dominio que reflejan el modelo de datos de PostgreSQL.
 * Mantener sincronizado con `sql/001_extend_schema.sql`.
 */

export type Rol = 'ADMIN' | 'SUPERVISOR' | 'VENDEDOR';

export type TipoDocumento = 'PRESUPUESTO' | 'FACTURA_A' | 'FACTURA_B';

/**
 * Ver `src/afip/types.ts` para el detalle de la integración con AFIP.
 * `PENDIENTE` es un estado transitorio dentro de la propia transacción de
 * facturación; en la práctica un documento persistido siempre termina en
 * APROBADO, CONTINGENCIA o RECHAZADO (o NULL si no es un comprobante fiscal,
 * ej. un PRESUPUESTO).
 */
export type EstadoAfip = 'PENDIENTE' | 'APROBADO' | 'CONTINGENCIA' | 'RECHAZADO' | 'APROBADO_INTERNO';

export interface Sucursal {
  id_sucursal: number;
  nombre: string;
}

export type TipoDocumentoCliente = 'DNI' | 'CUIT';

/**
 * Regla AFIP: un DNI sólo puede ser CONSUMIDOR_FINAL; un CUIT nunca puede
 * serlo (ver `crearCliente` en `clientes.service.ts`, que valida el cruce).
 */
export type CondicionIva = 'CONSUMIDOR_FINAL' | 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';

export interface Cliente {
  id_cliente: number;
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIva;
  limite_credito: string; // NUMERIC llega como string desde pg
  id_zona: number | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface CuentaEmpresa {
  id_cuenta: number;
  nombre_cuenta: string;
}

/** Alta de cliente en mostrador (ver `clientes.service.ts` -> `crearCliente`). */
export interface CrearClienteInput {
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  condicion_iva: CondicionIva;
  limite_credito?: number;
  id_zona?: number | null;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
}

// -----------------------------------------------------------------------
// Catálogo real de productos y stock por sucursal
// -----------------------------------------------------------------------

/**
 * KILO   -> subtotal = (cantidad * peso_teorico_kg) * precio_unitario ($/kg)
 * UNIDAD -> subtotal = cantidad * precio_unitario ($/unidad)
 * Ver `sql/007_productos_stock.sql`. Todavía no está conectado a
 * `facturarVenta` (sigue usando el catálogo hardcodeado).
 */
export type UnidadVentaProducto = 'KILO' | 'UNIDAD';

export interface Producto {
  id_producto: number;
  sku: string;
  descripcion: string;
  unidad_venta: UnidadVentaProducto;
  peso_teorico_kg: string; // NUMERIC llega como string desde pg
  activo: boolean;
}

/** Edición de producto (Gestión de Productos, F7). `sku` no se puede editar: es la referencia estable usada en ventas históricas. */
export interface ActualizarProductoInput {
  descripcion?: string;
  unidad_venta?: UnidadVentaProducto;
  peso_teorico_kg?: number;
  activo?: boolean;
}

export interface SucursalSecuencia {
  id_sucursal: number;
  tipo_documento: TipoDocumento;
  ultimo_numero: number;
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
  /** Suma de `remitos_detalles.cantidad_despachada` ya remitidos para este ítem (ver `sql/010_remitos.sql`). */
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
  id_zona: number | null;
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
}

/** Resumen de cliente embebido en la Ficha Contable (F9). */
export interface ResumenClienteCuentaCorriente {
  id_cliente: number;
  nombre: string;
  tipo_documento: TipoDocumentoCliente;
  numero_documento: string;
  limite_credito: string;
}

export interface FichaCuentaCorriente {
  cliente: ResumenClienteCuentaCorriente;
  movimientos: Array<MovimientoCuentaCorriente & { saldo: string }>;
  saldo_total: string;
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

/**
 * `descripcion`/`peso_teorico_kg`/`unidad_venta` NO viajan del cliente: se
 * resuelven server-side contra `productos` (ver `ventas.service.ts` ->
 * `obtenerProductos`), igual que `nombre_cuenta` para los pagos — así el
 * vendedor no puede alterar esos datos manipulando el request.
 */
/** Modo en que el vendedor/despachante cargó `cantidad`: conteo de unidades o kilos a convertir. Default 'U' si no viene. */
export type UnidadIngresoCantidad = 'U' | 'KG';

export interface ItemInput {
  id_producto: number;
  /** Tal como lo tipeó el vendedor: unidades si `unidad_ingreso` es 'U', kilos si es 'KG'. Ver `resolverCantidadUnidades`. */
  cantidad: number;
  unidad_ingreso?: UnidadIngresoCantidad;
  precio_unitario: number;
}

export interface FacturarVentaInput {
  cliente_id: number;
  items: ItemInput[];
  total_neto: number;
  pagos: PagoInput[];
  /** Elegido por el vendedor en Rendición de Pago (F5 fiscal / F6 interno). Default `true` si no viene. */
  es_fiscal?: boolean;
}

export interface FacturarVentaResult {
  documento: Documento;
  saldo_pendiente: number;
  movimientos: MovimientoCuentaCorriente[];
  autorizacion?: { supervisor: string; monto_excedido: number };
}

// -----------------------------------------------------------------------
// Integración AFIP (WSFE v1) y cola de contingencia
// -----------------------------------------------------------------------

export type EstadoTareaAfip = 'PENDIENTE' | 'PROCESANDO' | 'COMPLETADO' | 'FALLIDO';

export interface TareaColaAfip {
  id_tarea: number;
  id_documento: number;
  reintentos: number;
  proximo_reintento: string;
  estado: EstadoTareaAfip;
  ultimo_error: string | null;
}

/** Resumen para el indicador global del Header (ver `GET /api/afip/estado`). */
export interface EstadoServicioAfip {
  online: boolean;
  tareas_pendientes: number;
  tareas_falladas: number;
  ultima_contingencia: string | null;
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
  /** Código de Operación de Traslado (ARBA), cargado desde Control de Ruteo. */
  nro_cot: string | null;
}

export interface ActualizarCotInput {
  nro_cot: string;
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
// Remitos de entrega (ver `sql/010_remitos.sql`)
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
// Cuentas por Pagar (ver `sql/012_cuentas_por_pagar.sql`)
//
// Este incremento es sólo el CRUD de datos maestros (proveedores, facturas,
// notas de crédito, anticipos, cotizaciones). El motor contable (asientos
// automáticos de provisión/cancelación/retenciones) llega con el servicio
// de emisión de Órdenes de Pago, todavía no implementado.
// -----------------------------------------------------------------------

export type MonedaSoportada = 'ARS' | 'USD';

/** Sin CONSUMIDOR_FINAL: no aplica a un proveedor (ver `condicion_iva_proveedor` en la base). */
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
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export interface ActualizarProveedorInput {
  nombre?: string;
  condicion_iva?: CondicionIvaProveedor;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
  activo?: boolean;
}

export interface Cotizacion {
  id_cotizacion: number;
  moneda: MonedaSoportada;
  fecha: string;
  valor: string; // NUMERIC llega como string desde pg
  id_usuario_carga: number;
}

/** Carga manual diaria del tipo de cambio (upsert por moneda+fecha). */
export interface CargarCotizacionInput {
  moneda: MonedaSoportada;
  fecha: string; // 'YYYY-MM-DD'
  valor: number;
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
  fecha_vencimiento?: string | null;
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

export type EstadoAnticipoProveedor = 'DISPONIBLE' | 'PARCIAL' | 'APLICADO' | 'ANULADO';

/**
 * Sólo lectura en este incremento: un anticipo se origina en una Orden de
 * Pago sin imputaciones (ver comentario en `012_cuentas_por_pagar.sql`), así
 * que el alta llega con el servicio de emisión de OP, no acá.
 */
export interface AnticipoProveedor {
  id_anticipo_proveedor: number;
  id_proveedor: number;
  id_orden_pago_origen: number | null;
  fecha: string;
  moneda: MonedaSoportada;
  cotizacion: string;
  importe_total: string;
  saldo_disponible: string;
  estado: EstadoAnticipoProveedor;
}

// -----------------------------------------------------------------------
// Órdenes de Pago (ver `ordenesPago.service.ts`)
//
// Este incremento cubre sólo el pago de facturas existentes (con NC y
// anticipos YA EXISTENTES aplicados como descuento). Crear un anticipo
// nuevo (adelanto sin factura) queda para un incremento aparte — por eso
// `tipo: 'ANTICIPO'` referencia siempre un `anticipos_proveedor` ya cargado.
// -----------------------------------------------------------------------

export type TipoImputacionOP = 'FACTURA' | 'NOTA_CREDITO' | 'ANTICIPO';

export interface ImputacionOPInput {
  tipo: TipoImputacionOP;
  id: number;
  monto_imputado: number;
}

export type TipoRetencionOP = 'GANANCIAS' | 'IVA' | 'IIBB_ARBA' | 'IIBB_OTRA_JURISDICCION' | 'SUSS';

/** `monto_retenido` nunca lo manda el cliente: se recalcula server-side como `base_imponible * alicuota`. */
export interface RetencionOPInput {
  tipo_retencion: TipoRetencionOP;
  base_imponible: number;
  alicuota: number; // fracción (0 a 1), no porcentaje — 0.02 = 2%
}

export type TipoMedioPagoOP = 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO';

export interface MedioPagoOPInput {
  tipo: TipoMedioPagoOP;
  monto: number;
  nro_cheque?: string;
  banco_emisor?: string;
  fecha_pago_cheque?: string;
  cbu_destino?: string;
  nro_operacion?: string;
}

export interface EmitirOrdenPagoInput {
  id_proveedor: number;
  moneda?: MonedaSoportada; // default 'ARS'
  fecha?: string; // 'YYYY-MM-DD', default hoy; usada para resolver la cotización del día si moneda='USD'
  imputaciones: ImputacionOPInput[];
  retenciones?: RetencionOPInput[];
  medios_pago: MedioPagoOPInput[];
}

export type EstadoOrdenPago = 'EMITIDA' | 'ANULADA';

export interface OrdenPago {
  id_orden_pago: number;
  nro_op: string | null;
  id_proveedor: number;
  id_sucursal: number;
  fecha: string;
  moneda: MonedaSoportada;
  total_facturas: string;
  total_notas_credito: string;
  total_anticipos: string;
  total_retenciones: string;
  neto_a_pagar: string;
  diferencia_cambio: string; // positivo = pérdida, negativo = ganancia
  estado: EstadoOrdenPago;
  motivo_anulacion: string | null;
  id_usuario_anulo: number | null;
  fecha_anulacion: string | null;
  id_usuario_emitio: number;
}

export interface OpImputacion {
  id_op_imputacion: number;
  id_orden_pago: number;
  id_factura_proveedor: number | null;
  id_nota_credito_proveedor: number | null;
  id_anticipo_proveedor: number | null;
  monto_imputado: string;
}

export interface OpMedioPago {
  id_op_medio_pago: number;
  id_orden_pago: number;
  tipo: TipoMedioPagoOP;
  monto: string;
  nro_cheque: string | null;
  banco_emisor: string | null;
  fecha_pago_cheque: string | null;
  cbu_destino: string | null;
  nro_operacion: string | null;
}

export interface OpRetencion {
  id_op_retencion: number;
  id_orden_pago: number;
  tipo_retencion: TipoRetencionOP;
  base_imponible: string;
  alicuota: string;
  monto_retenido: string;
  nro_certificado: string | null;
  id_cuenta_contable: number | null;
}

export interface EmitirOrdenPagoResult {
  orden_pago: OrdenPago;
  imputaciones: OpImputacion[];
  retenciones: OpRetencion[];
  medios_pago: OpMedioPago[];
}

export interface AnularOrdenPagoInput {
  motivo: string;
}
