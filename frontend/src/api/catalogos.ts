import { apiFetch } from './client';
import type { CuentaEmpresa, Sucursal } from '../types/domain';

export function listarSucursales(): Promise<{ sucursales: Sucursal[] }> {
  return apiFetch('/catalogos/sucursales', { auth: false });
}

export function listarCuentasEmpresa(): Promise<{ cuentas: CuentaEmpresa[] }> {
  return apiFetch('/catalogos/cuentas-empresa');
}
