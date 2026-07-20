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
export interface ItemInput {
  id_producto: number;
  cantidad: number;
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
