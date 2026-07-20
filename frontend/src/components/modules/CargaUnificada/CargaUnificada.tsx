import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { buscarClientePorIdentificacion } from '../../../api/clientes';
import { guardarPresupuesto as guardarPresupuestoApi } from '../../../api/ventas';
import { Comprobante, type ComprobanteProps } from '../../common/Comprobante';
import { EstadoFiscalBadge } from '../../common/EstadoFiscalBadge';
import { useAuth } from '../../../context/AuthContext';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import type { Cliente, Documento, FacturarVentaResult, ItemInput, TipoDocumento } from '../../../types/domain';
import { CatalogoMateriales } from './CatalogoMateriales';
import { CrearCliente } from './CrearCliente';
import { RendicionPago } from './RendicionPago';

const ETIQUETA_TIPO: Record<TipoDocumento, string> = {
  FACTURA_A: 'Factura A (CUIT)',
  FACTURA_B: 'Factura B (DNI)',
  PRESUPUESTO: 'Presupuesto',
};

function calcularSubtotal(item: ItemInput): number {
  return Number((item.cantidad * item.peso_teorico_kg * item.precio_unitario).toFixed(2));
}

export function CargaUnificada({ onSalir }: { onSalir: () => void }): JSX.Element {
  const { sucursal } = useAuth();
  const [cuitDniInput, setCuitDniInput] = useState('');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento | null>(null);
  const [items, setItems] = useState<ItemInput[]>([]);
  const [catalogoAbierto, setCatalogoAbierto] = useState(false);
  const [rendicionAbierta, setRendicionAbierta] = useState(false);
  const [crearClienteAbierto, setCrearClienteAbierto] = useState(false);
  const [clienteNoEncontrado, setClienteNoEncontrado] = useState(false);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [guardandoPresupuesto, setGuardandoPresupuesto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [documentoFacturado, setDocumentoFacturado] = useState<Documento | null>(null);
  const [comprobante, setComprobante] = useState<ComprobanteProps | null>(null);

  const inputClienteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputClienteRef.current?.focus();
  }, []);

  // F2 imprime el presupuesto y F12 imprime el comprobante de venta al
  // confirmarse: dispara el diálogo de impresión del navegador apenas el
  // nodo #comprobante-imprimible (ver Comprobante.tsx) está en el DOM.
  useEffect(() => {
    if (!comprobante) return;
    const t = setTimeout(() => window.print(), 150);
    return () => clearTimeout(t);
  }, [comprobante]);

  useEffect(() => {
    if (!error && !mensaje) return;
    const t = setTimeout(() => {
      setError(null);
      setMensaje(null);
      setDocumentoFacturado(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [error, mensaje]);

  const total = Number(items.reduce((acc, i) => acc + calcularSubtotal(i), 0).toFixed(2));

  function quitarItem(indice: number): void {
    setItems((prev) => prev.filter((_, i) => i !== indice));
  }

  function limpiarFormulario(): void {
    setCuitDniInput('');
    setCliente(null);
    setTipoDocumento(null);
    setClienteNoEncontrado(false);
    setItems([]);
    inputClienteRef.current?.focus();
  }

  async function buscarCliente(): Promise<void> {
    if (!cuitDniInput.trim() || buscandoCliente) return;
    setBuscandoCliente(true);
    setError(null);
    setClienteNoEncontrado(false);
    try {
      const { cliente: encontrado, tipo_documento_sugerido } = await buscarClientePorIdentificacion(
        cuitDniInput.trim(),
      );
      setCliente(encontrado);
      setTipoDocumento(tipo_documento_sugerido);
    } catch (err) {
      setCliente(null);
      setTipoDocumento(null);
      if (err instanceof ApiError && err.code === 'CLIENTE_NO_ENCONTRADO') {
        setClienteNoEncontrado(true);
        setError('Cliente no encontrado. F6 para darlo de alta.');
      } else {
        setError(err instanceof ApiError ? err.message : 'No se pudo buscar el cliente.');
      }
    } finally {
      setBuscandoCliente(false);
    }
  }

  function onClienteCreado(nuevoCliente: Cliente): void {
    setCliente(nuevoCliente);
    setTipoDocumento(nuevoCliente.tipo_documento === 'CUIT' ? 'FACTURA_A' : 'FACTURA_B');
    setClienteNoEncontrado(false);
    setCrearClienteAbierto(false);
    setMensaje(`Cliente "${nuevoCliente.nombre}" creado.`);
  }

  async function guardarPresupuesto(): Promise<void> {
    if (!cliente || items.length === 0 || guardandoPresupuesto) {
      setError('Cargá un cliente y al menos un ítem antes de guardar el presupuesto.');
      return;
    }
    setGuardandoPresupuesto(true);
    setError(null);
    try {
      const { documento } = await guardarPresupuestoApi(cliente.id_cliente, items);
      setMensaje(`Presupuesto #${documento.id_documento} guardado.`);
      setComprobante({ documento, cliente, sucursalNombre: sucursal?.nombre ?? '' });
      limpiarFormulario();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el presupuesto.');
    } finally {
      setGuardandoPresupuesto(false);
    }
  }

  function onFacturado(resultado: FacturarVentaResult): void {
    if (!cliente) return;
    setRendicionAbierta(false);
    setDocumentoFacturado(resultado.documento);
    setMensaje(
      `${ETIQUETA_TIPO[resultado.documento.tipo_documento]} · Remito ${resultado.documento.nro_remito} · ` +
        `Saldo pendiente: $${resultado.saldo_pendiente.toFixed(2)}` +
        (resultado.autorizacion
          ? ` · Autorizado por ${resultado.autorizacion.supervisor} (excedía $${resultado.autorizacion.monto_excedido.toFixed(2)})`
          : ''),
    );
    setComprobante({
      documento: resultado.documento,
      cliente,
      sucursalNombre: sucursal?.nombre ?? '',
      pagos: resultado.movimientos
        .filter((m) => Number(m.haber) > 0)
        .map((m) => ({ concepto: m.concepto ?? 'Pago', monto: Number(m.haber) })),
      saldoPendiente: resultado.saldo_pendiente,
    });
    limpiarFormulario();
  }

  // F1/F2/F12 se desactivan mientras el modal de alta de cliente está
  // abierto: si no, con `cliente` todavía en null (recién se está cargando)
  // F12 dispararía "Cargá cliente e ítems..." en carrera con el F12 propio
  // del modal de alta (que confirma la creación).
  useGlobalHotkeys(
    {
      F1: () => {
        if (!cliente) {
          setError('Ingresá un cliente antes de abrir el catálogo (F1).');
          return;
        }
        setCatalogoAbierto(true);
      },
      F2: () => void guardarPresupuesto(),
      F12: () => {
        if (!cliente || items.length === 0) {
          setError('Cargá cliente e ítems antes de facturar (F12).');
          return;
        }
        if (!rendicionAbierta) setRendicionAbierta(true);
      },
    },
    !crearClienteAbierto,
  );

  // F6 abre el alta de cliente sólo cuando la búsqueda por CUIT/DNI dio 404.
  // Escape queda en un grupo aparte, siempre activo, para poder cerrar
  // cualquier modal abierto sin importar el estado de los demás atajos.
  useGlobalHotkeys({
    F6: () => {
      if (clienteNoEncontrado) setCrearClienteAbierto(true);
    },
    Escape: () => {
      if (crearClienteAbierto) setCrearClienteAbierto(false);
      else if (rendicionAbierta) setRendicionAbierta(false);
      else if (catalogoAbierto) setCatalogoAbierto(false);
      else onSalir();
    },
  });

  // Atajo separado del principal: sólo se registra (y por lo tanto sólo
  // hace preventDefault de Backspace) cuando no hay ningún modal con
  // inputs de texto abierto, para no interferir con el borrado de
  // caracteres dentro del catálogo o la rendición de pago.
  useGlobalHotkeys(
    { Backspace: () => setItems((prev) => prev.slice(0, -1)) },
    !catalogoAbierto && !rendicionAbierta && !crearClienteAbierto && items.length > 0,
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-6">
      <div className="flex items-end gap-4">
        <label className="block w-64 text-sm">
          <span className="mb-1 block text-neutral-600">CUIT / DNI del cliente</span>
          <input
            ref={inputClienteRef}
            value={cuitDniInput}
            onChange={(e) => setCuitDniInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void buscarCliente()}
            placeholder="Enter para buscar"
            disabled={cliente !== null}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento disabled:bg-neutral-50"
          />
        </label>

        {cliente && (
          <div className="flex items-center gap-3 text-sm">
            <div>
              <div className="font-medium text-neutral-900">{cliente.nombre}</div>
              <div className="text-xs text-neutral-500">
                Límite de crédito: ${Number(cliente.limite_credito).toFixed(2)}
              </div>
            </div>
            {tipoDocumento && (
              <span className="rounded bg-acento/10 px-2 py-1 text-xs font-medium text-acento">
                {ETIQUETA_TIPO[tipoDocumento]}
              </span>
            )}
            <button
              type="button"
              tabIndex={-1}
              onClick={limpiarFormulario}
              className="text-xs text-neutral-400 hover:text-neutral-600"
            >
              cambiar
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 rounded-lg border border-neutral-200">
        {/* select-text explícito: el mostrador necesita poder pintar con el mouse
            y copiar (Ctrl+C / click derecho) la descripción o el detalle de los
            ítems cargados para pegarlos en otro documento sin retipearlos. */}
        <table className="w-full select-text text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">Material</th>
              <th className="px-4 py-2 text-right">Cantidad</th>
              <th className="px-4 py-2 text-right">Kilos</th>
              <th className="px-4 py-2 text-right">Precio/kg</th>
              <th className="px-4 py-2 text-right">Subtotal</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="px-4 py-2">{item.descripcion}</td>
                <td className="px-4 py-2 text-right font-mono">{item.cantidad}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {(item.cantidad * item.peso_teorico_kg).toFixed(2)}
                </td>
                <td className="px-4 py-2 text-right font-mono">${item.precio_unitario.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono">${calcularSubtotal(item).toFixed(2)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => quitarItem(i)}
                    title="Quitar ítem"
                    className="text-neutral-400 hover:text-peligro"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Sin ítems. Presioná F1 para abrir el catálogo de hierros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-400">
          F1 catálogo · F2 presupuesto · F12 facturar (pago mixto) · Backspace quita el último ítem · Esc cancelar
        </div>
        <div className="text-lg font-semibold text-neutral-900">
          Total: <span className="font-mono">${total.toFixed(2)}</span>
        </div>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}
      {mensaje && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="rounded bg-green-50 px-3 py-2 text-sm text-exito">{mensaje}</p>
          {documentoFacturado && <EstadoFiscalBadge documento={documentoFacturado} />}
        </div>
      )}

      {catalogoAbierto && (
        <CatalogoMateriales
          onSeleccionar={(item) => {
            setItems((prev) => [...prev, item]);
            setCatalogoAbierto(false);
          }}
        />
      )}

      {rendicionAbierta && cliente && (
        <RendicionPago total={total} clienteId={cliente.id_cliente} items={items} onExito={onFacturado} />
      )}

      {crearClienteAbierto && (
        <CrearCliente numeroDocumentoInicial={cuitDniInput.trim()} onCreado={onClienteCreado} />
      )}

      {comprobante && <Comprobante {...comprobante} />}
    </div>
  );
}
