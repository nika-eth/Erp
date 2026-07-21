import { pool } from '../config/db';
import { AppError } from '../utils/AppError';
import { esCuitValido, largoValidoParaTipoDocumento } from '../utils/identificacion.utils';
import type { ActualizarProveedorInput, CondicionIvaProveedor, CrearProveedorInput, Proveedor } from '../types/domain';

const CONDICIONES_IVA_VALIDAS: CondicionIvaProveedor[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

const COLUMNAS_PROVEEDOR = `id_proveedor, nombre, tipo_documento, numero_documento, condicion_iva, direccion, telefono, email, activo`;

export async function buscarProveedorPorId(id_proveedor: number): Promise<Proveedor> {
  const { rows } = await pool.query<Proveedor>(
    `SELECT ${COLUMNAS_PROVEEDOR} FROM proveedores WHERE id_proveedor = $1`,
    [id_proveedor],
  );
  const proveedor = rows[0];
  if (!proveedor) {
    throw AppError.notFound('PROVEEDOR_NO_ENCONTRADO', `No existe el proveedor id_proveedor=${id_proveedor}`);
  }
  return proveedor;
}

/** Búsqueda por nombre o número de documento. Sólo proveedores activos (ver `buscarProveedoresParaGestion` para incluir inactivos). */
export async function buscarProveedores(termino: string): Promise<Proveedor[]> {
  const { rows } = await pool.query<Proveedor>(
    `SELECT ${COLUMNAS_PROVEEDOR}
     FROM proveedores
     WHERE activo = TRUE AND (numero_documento ILIKE $1 OR nombre ILIKE $1)
     ORDER BY nombre
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}

/** Incluye inactivos, para poder reactivarlos desde una futura pantalla de gestión. */
export async function buscarProveedoresParaGestion(termino: string): Promise<Proveedor[]> {
  const { rows } = await pool.query<Proveedor>(
    `SELECT ${COLUMNAS_PROVEEDOR}
     FROM proveedores
     WHERE numero_documento ILIKE $1 OR nombre ILIKE $1
     ORDER BY nombre
     LIMIT 20`,
    [`%${termino}%`],
  );
  return rows;
}

/**
 * Alta de proveedor. Mismas reglas fiscales que `crearCliente`
 * (`clientes.service.ts`): un CUIT necesita dígito verificador válido
 * (Módulo 11); a diferencia de un cliente, un proveedor nunca puede tener
 * condición IVA Consumidor Final (no existe en `condicion_iva_proveedor`).
 */
export async function crearProveedor(input: CrearProveedorInput): Promise<Proveedor> {
  const nombre = input.nombre?.trim() ?? '';
  const numeroDocumento = input.numero_documento?.trim().replace(/\D/g, '') ?? '';
  const tipoDocumento = input.tipo_documento;

  if (!nombre) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'El nombre del proveedor es requerido.');
  }
  if (tipoDocumento !== 'DNI' && tipoDocumento !== 'CUIT') {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'tipo_documento debe ser DNI o CUIT.');
  }
  if (!largoValidoParaTipoDocumento(tipoDocumento, numeroDocumento)) {
    throw AppError.badRequest(
      'PAYLOAD_INVALIDO',
      tipoDocumento === 'CUIT' ? 'Un CUIT debe tener 11 dígitos.' : 'Un DNI debe tener 7 u 8 dígitos.',
    );
  }
  if (tipoDocumento === 'CUIT' && !esCuitValido(numeroDocumento)) {
    throw AppError.badRequest('CUIT_INVALIDO', 'El CUIT ingresado no tiene un dígito verificador válido.');
  }
  if (!CONDICIONES_IVA_VALIDAS.includes(input.condicion_iva)) {
    throw AppError.badRequest(
      'CONDICION_IVA_INVALIDA',
      'condicion_iva debe ser Responsable Inscripto, Monotributo o Exento.',
    );
  }

  const { rows } = await pool.query<Proveedor>(
    `INSERT INTO proveedores (nombre, tipo_documento, numero_documento, condicion_iva, direccion, telefono, email)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNAS_PROVEEDOR}`,
    [
      nombre,
      tipoDocumento,
      numeroDocumento,
      input.condicion_iva,
      input.direccion?.trim() || null,
      input.telefono?.trim() || null,
      input.email?.trim() || null,
    ],
  );
  return rows[0];
}

/** `tipo_documento`/`numero_documento` no se pueden editar: son la identificación fiscal estable del proveedor. */
export async function actualizarProveedor(id_proveedor: number, input: ActualizarProveedorInput): Promise<Proveedor> {
  const campos: string[] = [];
  const valores: unknown[] = [];

  if (input.nombre !== undefined) {
    const nombre = input.nombre.trim();
    if (!nombre) {
      throw AppError.badRequest('PAYLOAD_INVALIDO', 'El nombre no puede quedar vacío.');
    }
    valores.push(nombre);
    campos.push(`nombre = $${valores.length}`);
  }
  if (input.condicion_iva !== undefined) {
    if (!CONDICIONES_IVA_VALIDAS.includes(input.condicion_iva)) {
      throw AppError.badRequest(
        'CONDICION_IVA_INVALIDA',
        'condicion_iva debe ser Responsable Inscripto, Monotributo o Exento.',
      );
    }
    valores.push(input.condicion_iva);
    campos.push(`condicion_iva = $${valores.length}`);
  }
  if (input.direccion !== undefined) {
    valores.push(input.direccion?.trim() || null);
    campos.push(`direccion = $${valores.length}`);
  }
  if (input.telefono !== undefined) {
    valores.push(input.telefono?.trim() || null);
    campos.push(`telefono = $${valores.length}`);
  }
  if (input.email !== undefined) {
    valores.push(input.email?.trim() || null);
    campos.push(`email = $${valores.length}`);
  }
  if (input.activo !== undefined) {
    valores.push(input.activo);
    campos.push(`activo = $${valores.length}`);
  }

  if (campos.length === 0) {
    throw AppError.badRequest('PAYLOAD_INVALIDO', 'No se envió ningún campo para actualizar.');
  }

  valores.push(id_proveedor);
  const { rows } = await pool.query<Proveedor>(
    `UPDATE proveedores SET ${campos.join(', ')} WHERE id_proveedor = $${valores.length}
     RETURNING ${COLUMNAS_PROVEEDOR}`,
    valores,
  );

  const proveedor = rows[0];
  if (!proveedor) {
    throw AppError.notFound('PROVEEDOR_NO_ENCONTRADO', `No existe el proveedor id_proveedor=${id_proveedor}`);
  }
  return proveedor;
}
