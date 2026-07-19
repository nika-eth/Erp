import { apiFetch } from './client';
import type { CuentaEmpresa, MaterialCatalogo, Sucursal } from '../types/domain';

export function listarSucursales(): Promise<{ sucursales: Sucursal[] }> {
  return apiFetch('/catalogos/sucursales', { auth: false });
}

export function listarCuentasEmpresa(): Promise<{ cuentas: CuentaEmpresa[] }> {
  return apiFetch('/catalogos/cuentas-empresa');
}

export function listarMateriales(): Promise<{ materiales: MaterialCatalogo[] }> {
  return apiFetch('/catalogos/materiales');
}
