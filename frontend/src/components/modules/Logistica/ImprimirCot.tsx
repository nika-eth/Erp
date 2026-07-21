import type { EnvioAsignado } from '../../../types/domain';

export interface ImprimirCotProps {
  envio: EnvioAsignado;
  patente: string;
  chofer: string;
  fecha: string;
}

/**
 * Vista imprimible del remito + COT (Código de Operación de Traslado,
 * exigido por ARBA) para un envío ya asignado a un camión. Reutiliza el
 * mismo nodo `#comprobante-imprimible` que `Comprobante.tsx` (ver
 * `index.css`): nunca están montados los dos a la vez, así que no hace
 * falta un selector CSS de impresión aparte.
 */
export function ImprimirCot({ envio, patente, chofer, fecha }: ImprimirCotProps): JSX.Element {
  return (
    <div id="comprobante-imprimible" className="bg-white p-10 text-sm text-neutral-900">
      <div className="mb-6 flex items-start justify-between border-b border-neutral-900 pb-4">
        <div>
          <h1 className="text-lg font-bold">ERP Metalúrgica</h1>
          <p className="text-neutral-600">Hoja de despacho</p>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold">Remito Nº {envio.nro_remito ?? envio.id_documento}</h2>
          <p className="text-neutral-600">Fecha de despacho: {fecha}</p>
        </div>
      </div>

      <div className="mb-6">
        <p className="font-semibold">{envio.cliente}</p>
        <p className="text-neutral-600">Zona: {envio.zona}</p>
      </div>

      <div className="mb-6">
        <p>
          Camión: <span className="font-semibold">{patente}</span> · Chofer: <span className="font-semibold">{chofer}</span>
        </p>
        <p>Kilos: {envio.kilosTotales} kg</p>
      </div>

      <div className="mt-10 border-t-2 border-neutral-900 pt-3">
        <p className="text-base font-bold">COT N°: {envio.nro_cot}</p>
      </div>
    </div>
  );
}
