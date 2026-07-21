import { useEffect, useRef, useState } from 'react';
import { crearFacturaProveedor } from '../../../api/facturasProveedor';
import { ApiError } from '../../../api/client';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { MonedaSoportada, Proveedor } from '../../../types/domain';
import { BuscadorProveedor } from './BuscadorProveedor';

const TIPOS_COMPROBANTE = ['FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M'];

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Carga de Factura de Proveedor (Cuentas por Pagar, F2). Genera automáticamente el asiento de Provisión de Pasivo. */
export function CargarFacturaProveedor({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState(TIPOS_COMPROBANTE[0]);
  const [puntoVenta, setPuntoVenta] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [moneda, setMoneda] = useState<MonedaSoportada>('ARS');
  const [cotizacion, setCotizacion] = useState('');
  const [importeNeto, setImporteNeto] = useState('');
  const [importeIva, setImporteIva] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const inputPuntoVentaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (proveedor) inputPuntoVentaRef.current?.focus();
  }, [proveedor]);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  const importeTotal = (Number(importeNeto) || 0) + (Number(importeIva) || 0);

  function limpiarComprobante(): void {
    setPuntoVenta('');
    setNroComprobante('');
    setFechaVencimiento('');
    setImporteNeto('');
    setImporteIva('');
    if (moneda === 'ARS') setCotizacion('');
  }

  async function confirmar(): Promise<void> {
    if (enviando || !proveedor) return;
    if (!puntoVenta || !nroComprobante) {
      setError('Punto de venta y número de comprobante son requeridos.');
      return;
    }
    if (!importeNeto || Number(importeNeto) < 0) {
      setError('El importe neto debe ser un número mayor o igual a 0.');
      return;
    }
    if (moneda === 'USD' && (!cotizacion || Number(cotizacion) <= 0)) {
      setError('Para una factura en USD, la cotización es requerida.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { factura } = await crearFacturaProveedor({
        id_proveedor: proveedor.id_proveedor,
        tipo_comprobante: tipoComprobante,
        punto_venta: Number(puntoVenta),
        nro_comprobante: Number(nroComprobante),
        fecha_emision: fechaEmision,
        fecha_vencimiento: fechaVencimiento || undefined,
        moneda,
        cotizacion: moneda === 'USD' ? Number(cotizacion) : undefined,
        importe_neto: Number(importeNeto),
        importe_iva: importeIva ? Number(importeIva) : undefined,
      });
      setMensaje(`Factura ${factura.tipo_comprobante} ${factura.punto_venta}-${factura.nro_comprobante} cargada por $${factura.importe_total}.`);
      limpiarComprobante();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la factura.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys(
    {
      F12: () => void confirmar(),
      Escape: () => (proveedor ? setProveedor(null) : onSalir()),
    },
    true,
  );

  if (!proveedor) {
    return (
      <div className="flex h-full flex-col gap-4 bg-white p-6">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Cargar Factura de Proveedor</h1>
        <div className="max-w-xl">
          <BuscadorProveedor onSeleccionar={setProveedor} />
        </div>
        <p className="text-xs text-neutral-400">Esc para volver</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Cargar Factura de Proveedor</h1>
        <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-700">
          {proveedor.nombre} · {proveedor.tipo_documento} {proveedor.numero_documento}
        </span>
      </div>

      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      <div className="grid max-w-3xl grid-cols-3 gap-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-neutral-600">Tipo de comprobante</span>
          <select
            value={tipoComprobante}
            onChange={(e) => setTipoComprobante(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            {TIPOS_COMPROBANTE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Punto de venta</span>
          <input
            ref={inputPuntoVentaRef}
            type="number"
            min="1"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Número de comprobante</span>
          <input
            type="number"
            min="1"
            value={nroComprobante}
            onChange={(e) => setNroComprobante(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Fecha de emisión</span>
          <input
            type="date"
            value={fechaEmision}
            onChange={(e) => setFechaEmision(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Fecha de vencimiento (opcional)</span>
          <input
            type="date"
            value={fechaVencimiento}
            onChange={(e) => setFechaVencimiento(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Moneda</span>
          <div className="flex gap-2">
            {(['ARS', 'USD'] as const).map((m) => (
              <button
                key={m}
                type="button"
                tabIndex={-1}
                onClick={() => setMoneda(m)}
                className={`flex-1 rounded border px-3 py-2 ${
                  moneda === m ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </label>

        {moneda === 'USD' && (
          <label className="block">
            <span className="mb-1 block text-neutral-600">Cotización</span>
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={cotizacion}
              onChange={(e) => setCotizacion(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-neutral-600">Importe neto</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={importeNeto}
            onChange={(e) => setImporteNeto(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">IVA (opcional)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={importeIva}
            onChange={(e) => setImporteIva(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>

        <div className="flex flex-col justify-end">
          <span className="mb-1 block text-neutral-600">Total (previsto)</span>
          <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono font-semibold text-neutral-900">
            {moneda} {importeTotal.toFixed(2)}
          </div>
        </div>
      </div>

      {error && <p className="max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="text-xs text-neutral-400">
        {enviando ? 'Guardando…' : 'F12 confirma y carga otra · Esc vuelve al buscador de proveedor'}
      </p>
    </div>
  );
}
