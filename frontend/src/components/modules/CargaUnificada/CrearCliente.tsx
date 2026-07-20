import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { crearCliente } from '../../../api/clientes';
import { listarZonas } from '../../../api/logistica';
import { useGlobalHotkeys } from '../../../hooks/useGlobalHotkeys';
import { Modal } from '../../common/Modal';
import type { Cliente, CondicionIva, TipoDocumentoCliente, Zona } from '../../../types/domain';

interface CrearClienteProps {
  numeroDocumentoInicial: string;
  onCreado: (cliente: Cliente) => void;
}

const ETIQUETA_CONDICION_IVA: Record<CondicionIva, string> = {
  CONSUMIDOR_FINAL: 'Consumidor Final',
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
};

/** DNI: nunca puede elegir otra cosa. CUIT: nunca puede ser Consumidor Final. */
const CONDICIONES_IVA_CUIT: CondicionIva[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

/** Sugerencia automática por longitud (7-8 dígitos DNI, 11 CUIT); el operador puede corregirla a mano. */
function detectarTipoDocumento(numeroDocumento: string): TipoDocumentoCliente | null {
  const digitos = numeroDocumento.replace(/\D/g, '');
  if (digitos.length === 11) return 'CUIT';
  if (digitos.length === 7 || digitos.length === 8) return 'DNI';
  return null;
}

/**
 * Alta de cliente (F6 en Carga Unificada, cuando la búsqueda por CUIT/DNI no
 * encuentra a nadie). Comportamiento reactivo por regla AFIP: un DNI sólo
 * puede ser Consumidor Final (el selector de IVA se deshabilita); un CUIT
 * nunca puede serlo (se oculta esa opción y se limpia si estaba elegida).
 * El backend vuelve a validar todo esto — acá es sólo para no dejar cargar
 * una combinación que el servidor va a rechazar.
 */
export function CrearCliente({ numeroDocumentoInicial, onCreado }: CrearClienteProps): JSX.Element {
  const [numeroDocumento, setNumeroDocumento] = useState(numeroDocumentoInicial);
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumentoCliente>(
    detectarTipoDocumento(numeroDocumentoInicial) ?? 'DNI',
  );
  const [condicionIva, setCondicionIva] = useState<CondicionIva>(
    detectarTipoDocumento(numeroDocumentoInicial) === 'CUIT' ? 'RESPONSABLE_INSCRIPTO' : 'CONSUMIDOR_FINAL',
  );
  const [nombre, setNombre] = useState('');
  const [limiteCredito, setLimiteCredito] = useState('');
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [idZona, setIdZona] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputNombreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarZonas().then((res) => setZonas(res.zonas));
    inputNombreRef.current?.focus();
  }, []);

  function onCambiarTipoDocumento(nuevoTipo: TipoDocumentoCliente): void {
    setTipoDocumento(nuevoTipo);
    if (nuevoTipo === 'DNI') {
      setCondicionIva('CONSUMIDOR_FINAL');
    } else if (condicionIva === 'CONSUMIDOR_FINAL') {
      setCondicionIva('RESPONSABLE_INSCRIPTO');
    }
  }

  function onCambiarNumeroDocumento(valor: string): void {
    setNumeroDocumento(valor);
    const detectado = detectarTipoDocumento(valor);
    if (detectado && detectado !== tipoDocumento) onCambiarTipoDocumento(detectado);
  }

  async function confirmar(): Promise<void> {
    if (enviando) return;
    if (!nombre.trim()) {
      setError('El nombre / razón social es requerido.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const { cliente } = await crearCliente({
        nombre: nombre.trim(),
        tipo_documento: tipoDocumento,
        numero_documento: numeroDocumento,
        condicion_iva: condicionIva,
        limite_credito: limiteCredito ? Number(limiteCredito) : undefined,
        id_zona: idZona ? Number(idZona) : null,
        direccion: direccion.trim() || undefined,
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
      });
      onCreado(cliente);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el cliente.');
    } finally {
      setEnviando(false);
    }
  }

  useGlobalHotkeys({ F12: () => void confirmar() });

  return (
    <Modal titulo="Nuevo Cliente (F12 confirma)" ancho="lg">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <label className="block">
          <span className="mb-1 block text-neutral-600">CUIT / DNI</span>
          <input
            value={numeroDocumento}
            onChange={(e) => onCambiarNumeroDocumento(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Tipo de documento</span>
          <div className="flex gap-2">
            {(['DNI', 'CUIT'] as const).map((t) => (
              <button
                key={t}
                type="button"
                tabIndex={-1}
                onClick={() => onCambiarTipoDocumento(t)}
                className={`flex-1 rounded border px-3 py-2 ${
                  tipoDocumento === t ? 'border-acento bg-acento/10 text-acento' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Nombre / Razón social</span>
          <input
            ref={inputNombreRef}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Condición frente al IVA</span>
          <select
            value={condicionIva}
            onChange={(e) => setCondicionIva(e.target.value as CondicionIva)}
            disabled={tipoDocumento === 'DNI'}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento disabled:bg-neutral-50 disabled:text-neutral-400"
          >
            {tipoDocumento === 'DNI' ? (
              <option value="CONSUMIDOR_FINAL">Consumidor Final</option>
            ) : (
              CONDICIONES_IVA_CUIT.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETA_CONDICION_IVA[c]}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Zona (logística, opcional)</span>
          <select
            value={idZona}
            onChange={(e) => setIdZona(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          >
            <option value="">Sin asignar</option>
            {zonas.map((z) => (
              <option key={z.id_zona} value={z.id_zona}>
                {z.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Límite de crédito</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={limiteCredito}
            onChange={(e) => setLimiteCredito(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-neutral-600">Teléfono (opcional)</span>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Dirección (opcional)</span>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>

        <label className="col-span-2 block">
          <span className="mb-1 block text-neutral-600">Email (opcional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 focus:border-acento"
          />
        </label>
      </div>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-peligro">{error}</p>}

      <p className="mt-4 text-xs text-neutral-400">{enviando ? 'Creando…' : 'F12 confirma · Esc cancela'}</p>
    </Modal>
  );
}
