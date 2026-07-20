import type { Cliente, Documento } from '../../types/domain';

const ETIQUETA_TIPO: Record<Documento['tipo_documento'], string> = {
  FACTURA_A: 'Factura A',
  FACTURA_B: 'Factura B',
  PRESUPUESTO: 'Presupuesto',
};

export interface ComprobantePago {
  concepto: string;
  monto: number;
}

export interface ComprobanteProps {
  documento: Documento;
  cliente: Cliente;
  sucursalNombre: string;
  pagos?: ComprobantePago[];
  saldoPendiente?: number;
}

/**
 * Vista imprimible del comprobante (F2 Presupuesto / F12 Factura). Se
 * mantiene siempre montada fuera de pantalla (ver `#comprobante-imprimible`
 * en index.css) y sólo se hace visible durante `window.print()`.
 */
export function Comprobante({ documento, cliente, sucursalNombre, pagos, saldoPendiente }: ComprobanteProps): JSX.Element {
  return (
    <div id="comprobante-imprimible" className="bg-white p-10 text-sm text-neutral-900">
      <div className="mb-6 flex items-start justify-between border-b border-neutral-900 pb-4">
        <div>
          <h1 className="text-lg font-bold">ERP Metalúrgica</h1>
          <p className="text-neutral-600">{sucursalNombre}</p>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold">
            {documento.estado_afip === 'APROBADO'
              ? ETIQUETA_TIPO[documento.tipo_documento]
              : documento.estado_afip === 'APROBADO_INTERNO'
                ? 'Comprobante Interno'
                : 'Remito de Contingencia'}
          </h2>
          <p className="text-neutral-600">
            {documento.nro_remito ? `Remito Nº ${documento.nro_remito}` : 'Sin numeración (no válido como factura)'}
          </p>
          <p className="text-neutral-600">{new Date(documento.fecha).toLocaleString('es-AR')}</p>
          {documento.estado_afip === 'APROBADO' && documento.cae && (
            <p className="mt-1 text-xs text-neutral-600">
              CAE: {documento.cae}
              {documento.cae_vencimiento && ` · Vto. ${new Date(documento.cae_vencimiento).toLocaleDateString('es-AR')}`}
            </p>
          )}
          {(documento.estado_afip === 'CONTINGENCIA' || documento.estado_afip === 'PENDIENTE') && (
            <p className="mt-1 text-xs font-medium text-amber-700">CAE pendiente de sincronización con AFIP</p>
          )}
          {documento.estado_afip === 'RECHAZADO' && (
            <p className="mt-1 text-xs font-medium text-peligro">AFIP rechazó este comprobante — requiere revisión</p>
          )}
          {documento.estado_afip === 'APROBADO_INTERNO' && (
            <p className="mt-1 text-xs font-semibold text-neutral-700">Documento No Válido como Factura</p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <p className="font-semibold">{cliente.nombre}</p>
        <p className="text-neutral-600">
          {cliente.tipo_documento}: {cliente.numero_documento}
        </p>
      </div>

      {/* select-text explícito: hay que poder copiar la descripción/detalle de los
          ítems (Ctrl+C o click derecho) para pegarlos en otro documento o sistema. */}
      <table className="mb-4 w-full select-text border-collapse text-left">
        <thead>
          <tr className="border-b border-neutral-400">
            <th className="py-1">Producto</th>
            <th className="py-1 text-right">Cantidad</th>
            <th className="py-1 text-right">Kilos</th>
            <th className="py-1 text-right">Precio</th>
            <th className="py-1 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {documento.items.map((item, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1">{item.descripcion}</td>
              <td className="py-1 text-right">{item.cantidad}</td>
              <td className="py-1 text-right">{item.kilos.toFixed(2)}</td>
              <td className="py-1 text-right">
                ${item.precio_unitario.toFixed(2)}
                {item.unidad_venta === 'KILO' ? '/kg' : '/u'}
              </td>
              <td className="py-1 text-right">${item.subtotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-6 flex justify-end">
        <p className="text-base font-bold">Total: ${Number(documento.total_neto).toFixed(2)}</p>
      </div>

      {pagos && pagos.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 font-semibold">Medios de pago</p>
          <table className="w-full border-collapse text-left">
            <tbody>
              {pagos.map((p, i) => (
                <tr key={i} className="border-b border-neutral-200">
                  <td className="py-1">{p.concepto}</td>
                  <td className="py-1 text-right">${p.monto.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {saldoPendiente !== undefined && saldoPendiente > 0 && (
        <p className="font-semibold">Saldo pendiente (cuenta corriente): ${saldoPendiente.toFixed(2)}</p>
      )}

      {documento.tipo_documento === 'PRESUPUESTO' && (
        <p className="mt-8 text-xs text-neutral-500">
          Presupuesto sin validez fiscal. No descuenta stock ni genera numeración de remito.
        </p>
      )}

      {documento.estado_afip === 'APROBADO_INTERNO' && (
        <p className="mt-8 text-xs font-semibold text-neutral-700">
          Documento No Válido como Factura — Comprobante Interno (Remito X), sin validez fiscal.
        </p>
      )}
    </div>
  );
}
