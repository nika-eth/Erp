import type { Documento } from '../../types/domain';

/**
 * Badge de estado fiscal AFIP para el resultado de facturar (F12) y el
 * comprobante impreso. No renderiza nada para PRESUPUESTO (`estado_afip`
 * viene `null`: no es un comprobante fiscal).
 */
export function EstadoFiscalBadge({ documento }: { documento: Documento }): JSX.Element | null {
  if (!documento.estado_afip || documento.estado_afip === 'PENDIENTE') return null;

  if (documento.estado_afip === 'APROBADO') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-green-50 px-2 py-1 text-xs font-medium text-exito">
        <span className="h-1.5 w-1.5 rounded-full bg-exito" />
        CAE: {documento.cae}
        {documento.cae_vencimiento && ` · Vto. ${new Date(documento.cae_vencimiento).toLocaleDateString('es-AR')}`}
      </span>
    );
  }

  if (documento.estado_afip === 'CONTINGENCIA') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Modo Contingencia · Remito {documento.nro_remito} Generado (CAE Pendiente de Sincronización)
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-red-50 px-2 py-1 text-xs font-medium text-peligro">
      <span className="h-1.5 w-1.5 rounded-full bg-peligro" />
      AFIP rechazó el comprobante{documento.error_afip_mensaje ? `: ${documento.error_afip_mensaje}` : ''}
    </span>
  );
}
