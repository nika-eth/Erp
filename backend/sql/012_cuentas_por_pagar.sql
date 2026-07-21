-- =============================================================================
-- Módulo de Cuentas por Pagar (Purchase-to-Pay) — incremento 1: sólo el
-- modelo de datos (sin tipos TypeScript, sin endpoints, sin frontend; eso
-- son los próximos dos incrementos ya acordados con el usuario).
--
-- Motor contable genérico (Plan de Cuentas jerárquico + Libro Diario)
-- reutilizable a futuro por otros módulos, aunque hoy sólo lo consume este.
-- El tipo de cambio se carga a mano (`cotizaciones`), sin integración
-- externa todavía.
--
-- Origen polimórfico de `asientos_contables`: en vez de un par genérico
-- (origen VARCHAR, id INTEGER) sin integridad referencial, se usan
-- múltiples columnas FK nullable (una por tipo de documento posible),
-- todas opcionales (un asiento manual/de ajuste puede no tener ninguna) ya
-- que el Libro Diario es genérico y se pensó reutilizable a futuro por
-- módulos que no son Cuentas por Pagar. `op_imputaciones`, en cambio, sí
-- exige exactamente un origen no-nulo (`num_nonnulls`) porque ahí cada fila
-- siempre imputa contra un único documento real. Varias de estas FKs
-- referencian tablas que se crean más abajo en este mismo archivo, así que
-- se agregan al final con `ALTER TABLE ... ADD CONSTRAINT` — mismo
-- problema de orden de creación ya documentado en `000_esquema_base.sql`
-- (ahí `fn_asignar_remito` depende de una columna que agrega un migration
-- posterior).
--
-- Numeración de `nro_op`: mismo patrón `sucursales_secuencias` +
-- `ON CONFLICT DO UPDATE ... RETURNING` que ya usan `fn_asignar_remito`
-- (documentos), `fn_asignar_nro_recibo` (recibos) y `fn_asignar_nro_remito`
-- (remitos), particionando por tipo_documento = 'ORDEN_PAGO'.
--
-- Balance obligatorio de asientos: `asientos_detalle` no tiene forma de
-- validarse fila a fila (el balance es una propiedad agregada de todas las
-- filas de un mismo `id_asiento`), así que se usa -por primera vez en este
-- repo- un `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`: corre
-- una sola vez al final de la transacción (no por cada INSERT) y aborta el
-- COMMIT si sum(debe) != sum(haber) para algún asiento tocado.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. Plan de Cuentas y Libro Diario (motor contable genérico)
-- -----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE tipo_cuenta_contable AS ENUM ('ACTIVO', 'PASIVO', 'PATRIMONIO_NETO', 'RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS plan_cuentas (
  id_cuenta_contable SERIAL PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(150) NOT NULL,
  id_cuenta_padre INTEGER REFERENCES plan_cuentas(id_cuenta_contable),
  tipo tipo_cuenta_contable NOT NULL,
  imputable BOOLEAN NOT NULL DEFAULT TRUE,
  es_sistema BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS asientos_contables (
  id_asiento SERIAL PRIMARY KEY,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  concepto VARCHAR(255) NOT NULL,
  id_factura_proveedor INTEGER,
  id_nota_credito_proveedor INTEGER,
  id_anticipo_proveedor INTEGER,
  id_orden_pago INTEGER,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asientos_detalle (
  id_asiento_detalle SERIAL PRIMARY KEY,
  id_asiento INTEGER NOT NULL REFERENCES asientos_contables(id_asiento),
  id_cuenta_contable INTEGER NOT NULL REFERENCES plan_cuentas(id_cuenta_contable),
  debe NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0))
);

CREATE INDEX IF NOT EXISTS idx_asientos_detalle_asiento ON asientos_detalle(id_asiento);
CREATE INDEX IF NOT EXISTS idx_asientos_detalle_cuenta ON asientos_detalle(id_cuenta_contable);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_padre ON plan_cuentas(id_cuenta_padre);

CREATE OR REPLACE FUNCTION fn_validar_balance_asiento() RETURNS TRIGGER AS $$
DECLARE
  v_id_asiento INTEGER;
  v_diferencia NUMERIC;
BEGIN
  v_id_asiento := COALESCE(NEW.id_asiento, OLD.id_asiento);

  SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0)
  INTO v_diferencia
  FROM asientos_detalle
  WHERE id_asiento = v_id_asiento;

  IF v_diferencia != 0 THEN
    RAISE EXCEPTION 'Asiento contable % desbalanceado: diferencia de %', v_id_asiento, v_diferencia
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Un CONSTRAINT TRIGGER debe ser FOR EACH ROW (Postgres no admite
-- FOR EACH STATEMENT ni transition tables en triggers de constraint), pero
-- al ser DEFERRABLE INITIALLY DEFERRED sigue corriendo recién al COMMIT,
-- cuando todas las filas del asiento ya están insertadas — cada fila
-- vuelve a sumar el total de su `id_asiento`, así que el resultado es el
-- mismo sin importar cuántas filas tenga el asiento.
DROP TRIGGER IF EXISTS trg_validar_balance_asiento ON asientos_detalle;
CREATE CONSTRAINT TRIGGER trg_validar_balance_asiento
  AFTER INSERT OR UPDATE OR DELETE ON asientos_detalle
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_validar_balance_asiento();

-- Cuentas de sistema mínimas: el servicio de emisión de OP (próximo
-- incremento) las busca por `codigo`, nunca por ID hardcodeado. Se insertan
-- en 3 pasadas (nivel 1 -> 2 -> 3) para poder resolver `id_cuenta_padre`
-- por `codigo` del nivel recién insertado y armar una jerarquía real.
INSERT INTO plan_cuentas (codigo, nombre, tipo, imputable, es_sistema) VALUES
  ('1', 'ACTIVO', 'ACTIVO', FALSE, TRUE),
  ('2', 'PASIVO', 'PASIVO', FALSE, TRUE),
  ('4', 'RESULTADOS POSITIVOS', 'RESULTADO_POSITIVO', FALSE, TRUE),
  ('5', 'RESULTADOS NEGATIVOS', 'RESULTADO_NEGATIVO', FALSE, TRUE)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO plan_cuentas (codigo, nombre, id_cuenta_padre, tipo, imputable, es_sistema)
SELECT v.codigo, v.nombre, padre.id_cuenta_contable, v.tipo::tipo_cuenta_contable, FALSE, TRUE
FROM (VALUES
  ('1.1', 'Caja y Bancos', 'ACTIVO', '1'),
  ('1.2', 'Créditos Fiscales', 'ACTIVO', '1'),
  ('2.1', 'Deudas Comerciales', 'PASIVO', '2'),
  ('2.2', 'Retenciones a Pagar', 'PASIVO', '2'),
  ('4.1', 'Diferencias de Cambio', 'RESULTADO_POSITIVO', '4'),
  ('5.1', 'Diferencias de Cambio', 'RESULTADO_NEGATIVO', '5')
) AS v(codigo, nombre, tipo, codigo_padre)
JOIN plan_cuentas padre ON padre.codigo = v.codigo_padre
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO plan_cuentas (codigo, nombre, id_cuenta_padre, tipo, imputable, es_sistema)
SELECT v.codigo, v.nombre, padre.id_cuenta_contable, v.tipo::tipo_cuenta_contable, TRUE, TRUE
FROM (VALUES
  ('1.1.01', 'Caja', 'ACTIVO', '1.1'),
  ('1.1.02', 'Banco Cuenta Corriente', 'ACTIVO', '1.1'),
  ('1.2.01', 'IVA Crédito Fiscal', 'ACTIVO', '1.2'),
  ('2.1.01', 'Proveedores', 'PASIVO', '2.1'),
  ('2.1.02', 'Anticipos a Proveedores', 'ACTIVO', '2.1'),
  ('2.2.01', 'Retención Ganancias a Pagar', 'PASIVO', '2.2'),
  ('2.2.02', 'Retención IVA a Pagar', 'PASIVO', '2.2'),
  ('2.2.03', 'Retención IIBB a Pagar', 'PASIVO', '2.2'),
  ('4.1.01', 'Diferencia de Cambio (ganancia)', 'RESULTADO_POSITIVO', '4.1'),
  ('5.1.01', 'Diferencia de Cambio (pérdida)', 'RESULTADO_NEGATIVO', '5.1')
) AS v(codigo, nombre, tipo, codigo_padre)
JOIN plan_cuentas padre ON padre.codigo = v.codigo_padre
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------
-- 2. Cotizaciones (tipo de cambio, carga manual)
-- -----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE moneda_soportada AS ENUM ('ARS', 'USD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id_cotizacion SERIAL PRIMARY KEY,
  moneda moneda_soportada NOT NULL,
  fecha DATE NOT NULL,
  valor NUMERIC(10, 4) NOT NULL CHECK (valor > 0),
  id_usuario_carga INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (moneda, fecha)
);

-- -----------------------------------------------------------------------
-- 3. Proveedores
-- -----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE condicion_iva_proveedor AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS proveedores (
  id_proveedor SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  tipo_documento tipo_documento_cliente NOT NULL,
  numero_documento VARCHAR(20) NOT NULL,
  condicion_iva condicion_iva_proveedor NOT NULL,
  direccion VARCHAR(255),
  telefono VARCHAR(50),
  email VARCHAR(150),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo_documento, numero_documento)
);

-- -----------------------------------------------------------------------
-- 4. Facturas, Notas de Crédito y Anticipos de Proveedor
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facturas_proveedor (
  id_factura_proveedor SERIAL PRIMARY KEY,
  id_proveedor INTEGER NOT NULL REFERENCES proveedores(id_proveedor),
  tipo_comprobante VARCHAR(20) NOT NULL,
  punto_venta INTEGER NOT NULL,
  nro_comprobante INTEGER NOT NULL,
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE,
  moneda moneda_soportada NOT NULL DEFAULT 'ARS',
  cotizacion NUMERIC(10, 4) NOT NULL DEFAULT 1,
  importe_neto NUMERIC(14, 2) NOT NULL CHECK (importe_neto >= 0),
  importe_iva NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (importe_iva >= 0),
  importe_total NUMERIC(14, 2) NOT NULL CHECK (importe_total >= 0),
  saldo_pendiente NUMERIC(14, 2) NOT NULL CHECK (saldo_pendiente >= 0 AND saldo_pendiente <= importe_total),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PARCIAL', 'PAGADA', 'ANULADA')),
  id_usuario_carga INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_proveedor, tipo_comprobante, punto_venta, nro_comprobante)
);

CREATE TABLE IF NOT EXISTS notas_credito_proveedor (
  id_nota_credito_proveedor SERIAL PRIMARY KEY,
  id_proveedor INTEGER NOT NULL REFERENCES proveedores(id_proveedor),
  id_factura_proveedor INTEGER REFERENCES facturas_proveedor(id_factura_proveedor),
  tipo_comprobante VARCHAR(20) NOT NULL,
  punto_venta INTEGER NOT NULL,
  nro_comprobante INTEGER NOT NULL,
  fecha_emision DATE NOT NULL,
  moneda moneda_soportada NOT NULL DEFAULT 'ARS',
  cotizacion NUMERIC(10, 4) NOT NULL DEFAULT 1,
  importe_total NUMERIC(14, 2) NOT NULL CHECK (importe_total > 0),
  saldo_disponible NUMERIC(14, 2) NOT NULL CHECK (saldo_disponible >= 0 AND saldo_disponible <= importe_total),
  estado VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE' CHECK (estado IN ('DISPONIBLE', 'PARCIAL', 'APLICADA', 'ANULADA')),
  id_usuario_carga INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id_proveedor, tipo_comprobante, punto_venta, nro_comprobante)
);

-- Supuesto a confirmar en el próximo incremento (servicio de OP): un
-- anticipo se origina en una Orden de Pago sin imputaciones (sale plata sin
-- cancelar ninguna factura todavía) y después otra OP lo imputa contra
-- facturas reales. Si el flujo real es otro, se ajusta ahí.
CREATE TABLE IF NOT EXISTS anticipos_proveedor (
  id_anticipo_proveedor SERIAL PRIMARY KEY,
  id_proveedor INTEGER NOT NULL REFERENCES proveedores(id_proveedor),
  id_orden_pago_origen INTEGER,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  moneda moneda_soportada NOT NULL DEFAULT 'ARS',
  cotizacion NUMERIC(10, 4) NOT NULL DEFAULT 1,
  importe_total NUMERIC(14, 2) NOT NULL CHECK (importe_total > 0),
  saldo_disponible NUMERIC(14, 2) NOT NULL CHECK (saldo_disponible >= 0 AND saldo_disponible <= importe_total),
  estado VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE' CHECK (estado IN ('DISPONIBLE', 'PARCIAL', 'APLICADO', 'ANULADO')),
  id_usuario_carga INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_proveedor_proveedor ON facturas_proveedor(id_proveedor);
CREATE INDEX IF NOT EXISTS idx_notas_credito_proveedor_proveedor ON notas_credito_proveedor(id_proveedor);
CREATE INDEX IF NOT EXISTS idx_anticipos_proveedor_proveedor ON anticipos_proveedor(id_proveedor);

-- -----------------------------------------------------------------------
-- 5. Órdenes de Pago
-- -----------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE estado_orden_pago AS ENUM ('EMITIDA', 'ANULADA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ordenes_pago (
  id_orden_pago SERIAL PRIMARY KEY,
  nro_op VARCHAR(20) UNIQUE,
  id_proveedor INTEGER NOT NULL REFERENCES proveedores(id_proveedor),
  id_sucursal INTEGER NOT NULL REFERENCES sucursales(id_sucursal),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  moneda moneda_soportada NOT NULL DEFAULT 'ARS',
  total_facturas NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_facturas >= 0),
  total_notas_credito NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_notas_credito >= 0),
  total_anticipos NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_anticipos >= 0),
  total_retenciones NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_retenciones >= 0),
  neto_a_pagar NUMERIC(14, 2) NOT NULL CHECK (neto_a_pagar >= 0),
  diferencia_cambio NUMERIC(14, 2) NOT NULL DEFAULT 0,
  estado estado_orden_pago NOT NULL DEFAULT 'EMITIDA',
  motivo_anulacion TEXT,
  id_usuario_anulo INTEGER REFERENCES usuarios(id_usuario),
  fecha_anulacion TIMESTAMPTZ,
  id_usuario_emitio INTEGER NOT NULL REFERENCES usuarios(id_usuario),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_asignar_nro_op() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO sucursales_secuencias (id_sucursal, tipo_documento, ultimo_numero)
  VALUES (NEW.id_sucursal, 'ORDEN_PAGO', 1)
  ON CONFLICT (id_sucursal, tipo_documento)
  DO UPDATE SET ultimo_numero = sucursales_secuencias.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  NEW.nro_op := 'OP-' || NEW.id_sucursal || '-' || LPAD(v_numero::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_nro_op ON ordenes_pago;
CREATE TRIGGER trg_asignar_nro_op
  BEFORE INSERT ON ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_nro_op();

CREATE TABLE IF NOT EXISTS op_imputaciones (
  id_op_imputacion SERIAL PRIMARY KEY,
  id_orden_pago INTEGER NOT NULL REFERENCES ordenes_pago(id_orden_pago),
  id_factura_proveedor INTEGER REFERENCES facturas_proveedor(id_factura_proveedor),
  id_nota_credito_proveedor INTEGER REFERENCES notas_credito_proveedor(id_nota_credito_proveedor),
  id_anticipo_proveedor INTEGER REFERENCES anticipos_proveedor(id_anticipo_proveedor),
  monto_imputado NUMERIC(14, 2) NOT NULL CHECK (monto_imputado > 0),
  CHECK (num_nonnulls(id_factura_proveedor, id_nota_credito_proveedor, id_anticipo_proveedor) = 1)
);

CREATE TABLE IF NOT EXISTS op_medios_pago (
  id_op_medio_pago SERIAL PRIMARY KEY,
  id_orden_pago INTEGER NOT NULL REFERENCES ordenes_pago(id_orden_pago),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('TRANSFERENCIA', 'CHEQUE', 'EFECTIVO')),
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  nro_cheque VARCHAR(30),
  banco_emisor VARCHAR(100),
  fecha_pago_cheque DATE,
  cbu_destino VARCHAR(22),
  nro_operacion VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS op_retenciones (
  id_op_retencion SERIAL PRIMARY KEY,
  id_orden_pago INTEGER NOT NULL REFERENCES ordenes_pago(id_orden_pago),
  tipo_retencion VARCHAR(30) NOT NULL CHECK (tipo_retencion IN ('GANANCIAS', 'IVA', 'IIBB_ARBA', 'IIBB_OTRA_JURISDICCION', 'SUSS')),
  base_imponible NUMERIC(14, 2) NOT NULL CHECK (base_imponible >= 0),
  alicuota NUMERIC(6, 4) NOT NULL CHECK (alicuota >= 0),
  monto_retenido NUMERIC(14, 2) NOT NULL CHECK (monto_retenido >= 0),
  nro_certificado VARCHAR(30),
  id_cuenta_contable INTEGER REFERENCES plan_cuentas(id_cuenta_contable)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_pago_proveedor ON ordenes_pago(id_proveedor);
CREATE INDEX IF NOT EXISTS idx_op_imputaciones_orden_pago ON op_imputaciones(id_orden_pago);
CREATE INDEX IF NOT EXISTS idx_op_medios_pago_orden_pago ON op_medios_pago(id_orden_pago);
CREATE INDEX IF NOT EXISTS idx_op_retenciones_orden_pago ON op_retenciones(id_orden_pago);

-- -----------------------------------------------------------------------
-- 6. FKs tardías (late binding): columnas creadas antes que la tabla que
--    referencian existiera en este mismo archivo.
-- -----------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE asientos_contables ADD CONSTRAINT fk_asientos_factura_proveedor
    FOREIGN KEY (id_factura_proveedor) REFERENCES facturas_proveedor(id_factura_proveedor);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE asientos_contables ADD CONSTRAINT fk_asientos_nota_credito_proveedor
    FOREIGN KEY (id_nota_credito_proveedor) REFERENCES notas_credito_proveedor(id_nota_credito_proveedor);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE asientos_contables ADD CONSTRAINT fk_asientos_anticipo_proveedor
    FOREIGN KEY (id_anticipo_proveedor) REFERENCES anticipos_proveedor(id_anticipo_proveedor);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE asientos_contables ADD CONSTRAINT fk_asientos_orden_pago
    FOREIGN KEY (id_orden_pago) REFERENCES ordenes_pago(id_orden_pago);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE anticipos_proveedor ADD CONSTRAINT fk_anticipos_orden_pago_origen
    FOREIGN KEY (id_orden_pago_origen) REFERENCES ordenes_pago(id_orden_pago);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
