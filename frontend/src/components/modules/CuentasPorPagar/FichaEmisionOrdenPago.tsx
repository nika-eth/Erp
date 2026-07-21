import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { buscarAnticiposProveedor } from '../../../api/anticiposProveedor';
import { buscarFacturasProveedor } from '../../../api/facturasProveedor';
import { buscarNotasCreditoProveedor } from '../../../api/notasCreditoProveedor';
import { emitirOrdenPago } from '../../../api/ordenesPago';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type {
  AnticipoProveedor,
  EmitirOrdenPagoResult,
  FacturaProveedor,
  MedioPagoOPInput,
  MonedaSoportada,
  NotaCreditoProveedor,
  Proveedor,
  TipoImputacionOP,
  TipoMedioPagoOP,
  TipoRetencionOP,
} from '../../../types/domain';
import { BuscadorProveedor } from './BuscadorProveedor';

const EPSILON = 0.01;

const TIPOS_RETENCION: TipoRetencionOP[] = ['GANANCIAS', 'IVA', 'IIBB_ARBA', 'IIBB_OTRA_JURISDICCION', 'SUSS'];
const ETIQUETA_RETENCION: Record<TipoRetencionOP, string> = {
  GANANCIAS: 'Ganancias',
  IVA: 'IVA',
  IIBB_ARBA: 'IIBB ARBA',
  IIBB_OTRA_JURISDICCION: 'IIBB Otra Jurisdicción',
  SUSS: 'SUSS',
};

const TIPOS_MEDIO_PAGO: TipoMedioPagoOP[] = ['TRANSFERENCIA', 'CHEQUE', 'EFECTIVO'];

interface RetencionForm {
  tipo_retencion: TipoRetencionOP;
  base_imponible: string;
  alicuota: string; // porcentaje tal como lo tipea el usuario (ej. "2" = 2%)
}

interface MedioPagoForm {
  tipo: TipoMedioPagoOP;
  monto: string;
  nro_cheque: string;
  banco_emisor: string;
  fecha_pago_cheque: string;
  cbu_destino: string;
  nro_operacion: string;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function redondear(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Ficha de Emisión de Orden de Pago (Cuentas por Pagar, F4). Selecciona
 * facturas/NC/anticipos pendientes del proveedor para imputar, calcula
 * retenciones y valida en vivo (useMemo) que los medios de pago cierren
 * exactamente contra el neto a pagar — el backend vuelve a validar todo
 * esto de forma independiente (`ordenesPago.service.ts::emitirOrdenPago`),
 * acá es sólo para no dejar emitir algo que el servidor va a rechazar.
 */
export function FichaEmisionOrdenPago({ onSalir }: { onSalir: () => void }): JSX.Element {
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [moneda, setMoneda] = useState<MonedaSoportada>('ARS');
  const [facturas, setFacturas] = useState<FacturaProveedor[]>([]);
  const [notasCredito, setNotasCredito] = useState<NotaCreditoProveedor[]>([]);
  const [anticipos, setAnticipos] = useState<AnticipoProveedor[]>([]);
  const [seleccion, setSeleccion] = useState<Map<string, number>>(new Map());
  const [retenciones, setRetenciones] = useState<RetencionForm[]>([]);
  const [mediosPago, setMediosPago] = useState<MedioPagoForm[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<EmitirOrdenPagoResult | null>(null);

  const inputMedioRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!proveedor) return;
    setSeleccion(new Map());
    Promise.all([
      buscarFacturasProveedor(proveedor.id_proveedor),
      buscarNotasCreditoProveedor(proveedor.id_proveedor),
      buscarAnticiposProveedor(proveedor.id_proveedor),
    ]).then(([f, n, a]) => {
      setFacturas(f.facturas.filter((x) => x.estado === 'PENDIENTE' || x.estado === 'PARCIAL'));
      setNotasCredito(n.notasCredito.filter((x) => x.estado === 'DISPONIBLE' || x.estado === 'PARCIAL'));
      setAnticipos(a.anticipos.filter((x) => x.estado === 'DISPONIBLE' || x.estado === 'PARCIAL'));
    });
  }, [proveedor]);

  const facturasMoneda = useMemo(() => facturas.filter((f) => f.moneda === moneda), [facturas, moneda]);
  const notasCreditoMoneda = useMemo(() => notasCredito.filter((n) => n.moneda === moneda), [notasCredito, moneda]);
  const anticiposMoneda = useMemo(() => anticipos.filter((a) => a.moneda === moneda), [anticipos, moneda]);

  function claveImputacion(tipo: TipoImputacionOP, id: number): string {
    return `${tipo}:${id}`;
  }

  function alternarSeleccion(tipo: TipoImputacionOP, id: number, saldoMax: number): void {
    setSeleccion((mapa) => {
      const nuevo = new Map(mapa);
      const clave = claveImputacion(tipo, id);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.set(clave, saldoMax);
      return nuevo;
    });
  }

  function actualizarMontoImputado(tipo: TipoImputacionOP, id: number, monto: number): void {
    setSeleccion((mapa) => {
      const nuevo = new Map(mapa);
      nuevo.set(claveImputacion(tipo, id), monto);
      return nuevo;
    });
  }

  // Cálculo en tiempo real de totales y de la diferencia que decide si se puede emitir.
  const resumen = useMemo(() => {
    let totalFacturas = 0;
    let totalNotasCredito = 0;
    let totalAnticipos = 0;
    for (const [clave, monto] of seleccion) {
      const tipo = clave.split(':')[0] as TipoImputacionOP;
      if (tipo === 'FACTURA') totalFacturas = redondear(totalFacturas + monto);
      else if (tipo === 'NOTA_CREDITO') totalNotasCredito = redondear(totalNotasCredito + monto);
      else totalAnticipos = redondear(totalAnticipos + monto);
    }

    const retencionesCalculadas = retenciones.map((r) => ({
      ...r,
      monto_retenido: redondear(((Number(r.base_imponible) || 0) * (Number(r.alicuota) || 0)) / 100),
    }));
    const totalRetenciones = redondear(retencionesCalculadas.reduce((acc, r) => acc + r.monto_retenido, 0));

    const netoAPagar = redondear(totalFacturas - totalNotasCredito - totalAnticipos - totalRetenciones);
    const totalMediosPago = redondear(mediosPago.reduce((acc, m) => acc + (Number(m.monto) || 0), 0));
    const diferencia = redondear(totalMediosPago - netoAPagar);

    return { totalFacturas, totalNotasCredito, totalAnticipos, retencionesCalculadas, totalRetenciones, netoAPagar, totalMediosPago, diferencia };
  }, [seleccion, retenciones, mediosPago]);

  const puedeEmitir =
    seleccion.size > 0 && mediosPago.length > 0 && resumen.netoAPagar >= 0 && Math.abs(resumen.diferencia) < EPSILON;

  function agregarRetencion(): void {
    setRetenciones((lista) => [...lista, { tipo_retencion: 'GANANCIAS', base_imponible: '', alicuota: '' }]);
  }

  function quitarRetencion(indice: number): void {
    setRetenciones((lista) => lista.filter((_, i) => i !== indice));
  }

  function agregarMedioPago(): void {
    setMediosPago((lista) => [
      ...lista,
      { tipo: 'TRANSFERENCIA', monto: '', nro_cheque: '', banco_emisor: '', fecha_pago_cheque: '', cbu_destino: '', nro_operacion: '' },
    ]);
  }

  function quitarMedioPago(indice: number): void {
    setMediosPago((lista) => lista.filter((_, i) => i !== indice));
  }

  async function confirmar(): Promise<void> {
    if (enviando || !proveedor || !puedeEmitir) return;
    setEnviando(true);
    setError(null);
    try {
      const imputaciones = Array.from(seleccion.entries()).map(([clave, monto_imputado]) => {
        const [tipo, idStr] = clave.split(':');
        return { tipo: tipo as TipoImputacionOP, id: Number(idStr), monto_imputado };
      });
      const medios_pago: MedioPagoOPInput[] = mediosPago.map((m) => ({
        tipo: m.tipo,
        monto: Number(m.monto),
        nro_cheque: m.tipo === 'CHEQUE' ? m.nro_cheque.trim() || undefined : undefined,
        banco_emisor: m.tipo === 'CHEQUE' ? m.banco_emisor.trim() || undefined : undefined,
        fecha_pago_cheque: m.tipo === 'CHEQUE' ? m.fecha_pago_cheque || undefined : undefined,
        cbu_destino: m.tipo === 'TRANSFERENCIA' ? m.cbu_destino.trim() || undefined : undefined,
        nro_operacion: m.tipo !== 'EFECTIVO' ? m.nro_operacion.trim() || undefined : undefined,
      }));
      const resultadoEmision = await emitirOrdenPago({
        id_proveedor: proveedor.id_proveedor,
        moneda,
        fecha: hoyISO(),
        imputaciones,
        retenciones: retenciones
          .filter((r) => r.base_imponible && r.alicuota)
          .map((r) => ({ tipo_retencion: r.tipo_retencion, base_imponible: Number(r.base_imponible), alicuota: Number(r.alicuota) / 100 })),
        medios_pago,
      });
      setResultado(resultadoEmision);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo emitir la Orden de Pago.');
    } finally {
      setEnviando(false);
    }
  }

  function nuevaOrden(): void {
    setResultado(null);
    setProveedor(null);
    setSeleccion(new Map());
    setRetenciones([]);
    setMediosPago([]);
    setError(null);
  }

  useGlobalHotkeys(
    {
      F12: () => void confirmar(),
      Escape: () => (proveedor ? setProveedor(null) : onSalir()),
    },
    !resultado,
  );
  useGlobalHotkeys({ Escape: nuevaOrden }, !!resultado);

  if (resultado) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-white p-6">
        <p className="text-sm uppercase tracking-widest text-exito">Orden de Pago emitida</p>
        <p className="font-mono text-3xl font-bold text-neutral-900">{resultado.orden_pago.nro_op}</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-neutral-600">
          <span>Neto a pagar</span>
          <span className="text-right font-mono">
            {resultado.orden_pago.moneda} {resultado.orden_pago.neto_a_pagar}
          </span>
          <span>Diferencia de cambio</span>
          <span className="text-right font-mono">ARS {resultado.orden_pago.diferencia_cambio}</span>
        </div>
        <p className="mt-4 text-xs text-neutral-400">Esc para emitir otra Orden de Pago</p>
      </div>
    );
  }

  if (!proveedor) {
    return (
      <div className="flex h-full flex-col gap-4 bg-white p-6">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Emitir Orden de Pago</h1>
        <div className="max-w-xl">
          <BuscadorProveedor onSeleccionar={setProveedor} />
        </div>
        <p className="text-xs text-neutral-400">Esc para volver</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">Emitir Orden de Pago</h1>
        <div className="flex items-center gap-3">
          <span className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-700">
            {proveedor.nombre} · {proveedor.tipo_documento} {proveedor.numero_documento}
          </span>
          <div className="flex gap-2">
            {(['ARS', 'USD'] as const).map((m) => (
              <button
                key={m}
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setMoneda(m);
                  setSeleccion(new Map());
                }}
                className={`rounded border px-3 py-1 text-sm ${
                  moneda === m ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="flex flex-col gap-4">
          <TablaImputacion
            titulo="Facturas pendientes"
            filas={facturasMoneda.map((f) => ({
              id: f.id_factura_proveedor,
              etiqueta: `${f.tipo_comprobante} ${f.punto_venta}-${f.nro_comprobante}`,
              saldo: Number(f.saldo_pendiente),
            }))}
            tipo="FACTURA"
            seleccion={seleccion}
            moneda={moneda}
            onAlternar={alternarSeleccion}
            onCambiarMonto={actualizarMontoImputado}
          />
          <TablaImputacion
            titulo="Notas de crédito disponibles"
            filas={notasCreditoMoneda.map((n) => ({
              id: n.id_nota_credito_proveedor,
              etiqueta: `${n.tipo_comprobante} ${n.punto_venta}-${n.nro_comprobante}`,
              saldo: Number(n.saldo_disponible),
            }))}
            tipo="NOTA_CREDITO"
            seleccion={seleccion}
            moneda={moneda}
            onAlternar={alternarSeleccion}
            onCambiarMonto={actualizarMontoImputado}
          />
          <TablaImputacion
            titulo="Anticipos disponibles"
            filas={anticiposMoneda.map((a) => ({
              id: a.id_anticipo_proveedor,
              etiqueta: `Anticipo #${a.id_anticipo_proveedor}`,
              saldo: Number(a.saldo_disponible),
            }))}
            tipo="ANTICIPO"
            seleccion={seleccion}
            moneda={moneda}
            onAlternar={alternarSeleccion}
            onCambiarMonto={actualizarMontoImputado}
          />

          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Retenciones</h2>
              <button type="button" tabIndex={-1} onClick={agregarRetencion} className="text-xs text-acento hover:underline">
                + Agregar retención
              </button>
            </div>
            {retenciones.length === 0 && <p className="text-xs text-neutral-400">Sin retenciones cargadas.</p>}
            {retenciones.map((r, i) => (
              <div key={i} className="mb-2 grid grid-cols-4 items-center gap-2 text-sm">
                <select
                  value={r.tipo_retencion}
                  onChange={(e) =>
                    setRetenciones((lista) => lista.map((x, j) => (j === i ? { ...x, tipo_retencion: e.target.value as TipoRetencionOP } : x)))
                  }
                  className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  {TIPOS_RETENCION.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETA_RETENCION[t]}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Base imponible"
                  value={r.base_imponible}
                  onChange={(e) => setRetenciones((lista) => lista.map((x, j) => (j === i ? { ...x, base_imponible: e.target.value } : x)))}
                  className="rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="Alícuota %"
                  value={r.alicuota}
                  onChange={(e) => setRetenciones((lista) => lista.map((x, j) => (j === i ? { ...x, alicuota: e.target.value } : x)))}
                  className="rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
                />
                <div className="flex items-center justify-between font-mono text-xs">
                  <span>${resumen.retencionesCalculadas[i]?.monto_retenido.toFixed(2) ?? '0.00'}</span>
                  <button type="button" tabIndex={-1} onClick={() => quitarRetencion(i)} className="text-neutral-400 hover:text-peligro">
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Medios de pago</h2>
              <button type="button" tabIndex={-1} onClick={agregarMedioPago} className="text-xs text-acento hover:underline">
                + Agregar medio de pago
              </button>
            </div>
            {mediosPago.length === 0 && <p className="text-xs text-neutral-400">Sin medios de pago cargados.</p>}
            {mediosPago.map((m, i) => (
              <div key={i} className="mb-2 flex flex-col gap-2 rounded border border-neutral-100 p-2">
                <div className="grid grid-cols-3 items-center gap-2 text-sm">
                  <select
                    ref={i === 0 ? inputMedioRef : undefined}
                    value={m.tipo}
                    onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoMedioPagoOP } : x)))}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                  >
                    {TIPOS_MEDIO_PAGO.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Monto"
                    value={m.monto}
                    onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))}
                    className="rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
                  />
                  <button type="button" tabIndex={-1} onClick={() => quitarMedioPago(i)} className="justify-self-end text-neutral-400 hover:text-peligro">
                    ×
                  </button>
                </div>
                {m.tipo === 'CHEQUE' && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <input
                      placeholder="N° cheque"
                      value={m.nro_cheque}
                      onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, nro_cheque: e.target.value } : x)))}
                      className="rounded border border-neutral-300 px-2 py-1.5"
                    />
                    <input
                      placeholder="Banco emisor"
                      value={m.banco_emisor}
                      onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, banco_emisor: e.target.value } : x)))}
                      className="rounded border border-neutral-300 px-2 py-1.5"
                    />
                    <input
                      type="date"
                      value={m.fecha_pago_cheque}
                      onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, fecha_pago_cheque: e.target.value } : x)))}
                      className="rounded border border-neutral-300 px-2 py-1.5"
                    />
                  </div>
                )}
                {m.tipo === 'TRANSFERENCIA' && (
                  <input
                    placeholder="CBU destino (opcional)"
                    value={m.cbu_destino}
                    onChange={(e) => setMediosPago((lista) => lista.map((x, j) => (j === i ? { ...x, cbu_destino: e.target.value } : x)))}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="h-fit rounded-lg border border-neutral-200 bg-neutral-50 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Resumen</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-neutral-600">Total facturas</span>
            <span className="text-right font-mono">{resumen.totalFacturas.toFixed(2)}</span>
            <span className="text-neutral-600">Notas de crédito</span>
            <span className="text-right font-mono">-{resumen.totalNotasCredito.toFixed(2)}</span>
            <span className="text-neutral-600">Anticipos</span>
            <span className="text-right font-mono">-{resumen.totalAnticipos.toFixed(2)}</span>
            <span className="text-neutral-600">Retenciones</span>
            <span className="text-right font-mono">-{resumen.totalRetenciones.toFixed(2)}</span>
            <span className="border-t border-neutral-300 pt-2 font-semibold text-neutral-900">Neto a pagar</span>
            <span className="border-t border-neutral-300 pt-2 text-right font-mono font-semibold text-neutral-900">
              {moneda} {resumen.netoAPagar.toFixed(2)}
            </span>
            <span className="text-neutral-600">Medios de pago</span>
            <span className="text-right font-mono">{resumen.totalMediosPago.toFixed(2)}</span>
            <span className="font-semibold">Diferencia</span>
            <span className={`text-right font-mono font-semibold ${Math.abs(resumen.diferencia) < EPSILON ? 'text-exito' : 'text-peligro'}`}>
              {resumen.diferencia.toFixed(2)}
            </span>
          </div>

          {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

          <button
            type="button"
            disabled={!puedeEmitir || enviando}
            onClick={() => void confirmar()}
            className="mt-4 w-full rounded bg-acento px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {enviando ? 'Emitiendo…' : 'F12 · Emitir Orden de Pago'}
          </button>
          <p className="mt-2 text-center text-xs text-neutral-400">Esc vuelve al buscador de proveedor</p>
        </div>
      </div>
    </div>
  );
}

interface FilaImputacion {
  id: number;
  etiqueta: string;
  saldo: number;
}

function TablaImputacion({
  titulo,
  filas,
  tipo,
  seleccion,
  moneda,
  onAlternar,
  onCambiarMonto,
}: {
  titulo: string;
  filas: FilaImputacion[];
  tipo: TipoImputacionOP;
  seleccion: Map<string, number>;
  moneda: MonedaSoportada;
  onAlternar: (tipo: TipoImputacionOP, id: number, saldoMax: number) => void;
  onCambiarMonto: (tipo: TipoImputacionOP, id: number, monto: number) => void;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{titulo}</h2>
      {filas.length === 0 && <p className="text-xs text-neutral-400">Sin comprobantes pendientes en {moneda}.</p>}
      {filas.map((fila) => {
        const clave = `${tipo}:${fila.id}`;
        const seleccionado = seleccion.has(clave);
        return (
          <label key={fila.id} className="mb-1 flex items-center gap-3 text-sm">
            <input type="checkbox" checked={seleccionado} onChange={() => onAlternar(tipo, fila.id, fila.saldo)} />
            <span className="flex-1">{fila.etiqueta}</span>
            <span className="font-mono text-xs text-neutral-400">saldo {fila.saldo.toFixed(2)}</span>
            <input
              type="number"
              min="0"
              max={fila.saldo}
              step="0.01"
              disabled={!seleccionado}
              value={seleccionado ? seleccion.get(clave) : ''}
              onChange={(e) => onCambiarMonto(tipo, fila.id, Number(e.target.value))}
              className="w-28 rounded border border-neutral-300 px-2 py-1 font-mono text-xs disabled:bg-neutral-50"
            />
          </label>
        );
      })}
    </div>
  );
}
