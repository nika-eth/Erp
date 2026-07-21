import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { buscarFacturasProveedor } from '../../../api/facturasProveedor';
import { crearNotaCreditoProveedor } from '../../../api/notasCreditoProveedor';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { FacturaProveedor, MonedaSoportada, Proveedor } from '../../../types/domain';
import { BuscadorProveedor } from './BuscadorProveedor';

const TIPOS_COMPROBANTE = ['NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C', 'NOTA_CREDITO_M'];

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Carga de Nota de Crédito de Proveedor (Cuentas por Pagar, F3). Genera automáticamente el asiento de reversa contra Compras. */
export function CargarNotaCreditoProveedor({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaProveedor[]>([]);
  const [idFacturaVinculada, setIdFacturaVinculada] = useState('');
  const [tipoComprobante, setTipoComprobante] = useState(TIPOS_COMPROBANTE[0]);
  const [puntoVenta, setPuntoVenta] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [fechaEmision, setFechaEmision] = useState(hoyISO());
  const [moneda, setMoneda] = useState<MonedaSoportada>('ARS');
  const [cotizacion, setCotizacion] = useState('');
  const [importeTotal, setImporteTotal] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const inputPuntoVentaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!proveedor) return;
    inputPuntoVentaRef.current?.focus();
    buscarFacturasProveedor(proveedor.id_proveedor).then((res) => {
      setFacturasPendientes(res.facturas.filter((f) => f.estado === 'PENDIENTE' || f.estado === 'PARCIAL'));
    });
  }, [proveedor]);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), 5000);
    return () => clearTimeout(t);
  }, [mensaje]);

  function limpiarComprobante(): void {
    setPuntoVenta('');
    setNroComprobante('');
    setImporteTotal('');
    setIdFacturaVinculada('');
    if (moneda === 'ARS') setCotizacion('');
  }

  async function confirmar(): Promise<void> {
    if (enviando || !proveedor) return;
    if (!puntoVenta || !nroComprobante) {
      setError('Punto de venta y número de comprobante son requeridos.');
      return;
    }
    if (!importeTotal || Number(importeTotal) <= 0) {
      setError('El importe total debe ser un número mayor a 0.');
      return;
    }
    if (moneda === 'USD' && (!cotizacion || Number(cotizacion) <= 0)) {
      setError('Para una nota de crédito en USD, la cotización es requerida.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { notaCredito } = await crearNotaCreditoProveedor({
        id_proveedor: proveedor.id_proveedor,
        id_factura_proveedor: idFacturaVinculada ? Number(idFacturaVinculada) : undefined,
        tipo_comprobante: tipoComprobante,
        punto_venta: Number(puntoVenta),
        nro_comprobante: Number(nroComprobante),
        fecha_emision: fechaEmision,
        moneda,
        cotizacion: moneda === 'USD' ? Number(cotizacion) : undefined,
        importe_total: Number(importeTotal),
      });
      setMensaje(
        `Nota de crédito ${notaCredito.tipo_comprobante} ${notaCredito.punto_venta}-${notaCredito.nro_comprobante} cargada por $${notaCredito.importe_total}.`,
      );
      limpiarComprobante();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la nota de crédito.');
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
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Cargar Nota de Crédito de Proveedor</h1>
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
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Cargar Nota de Crédito de Proveedor</h1>
        <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-700">
          {proveedor.nombre} · {proveedor.tipo_documento} {proveedor.numero_documento}
        </span>
      </div>

      {mensaje && <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>}

      <div className="grid max-w-3xl grid-cols-3 gap-4 text-sm">
        <label className="col-span-3 block">
          <span className="mb-1 block text-neutral-600">Vincular a factura (opcional)</span>
          <select
            value={idFacturaVinculada}
            onChange={(e) => setIdFacturaVinculada(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            <option value="">Sin vincular</option>
            {facturasPendientes.map((f) => (
              <option key={f.id_factura_proveedor} value={f.id_factura_proveedor}>
                {f.tipo_comprobante} {f.punto_venta}-{f.nro_comprobante} · saldo {f.moneda} {f.saldo_pendiente}
              </option>
            ))}
          </select>
        </label>

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
          <span className="mb-1 block text-neutral-600">Importe total</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={importeTotal}
            onChange={(e) => setImporteTotal(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono focus:border-acento"
          />
        </label>
      </div>

      {error && <p className="max-w-3xl rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="text-xs text-neutral-400">
        {enviando ? 'Guardando…' : 'F12 confirma y carga otra · Esc vuelve al buscador de proveedor'}
      </p>
    </div>
  );
}
