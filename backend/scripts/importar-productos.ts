/**
 * CLI: importa/actualiza el catálogo `productos` desde el Excel de stock del
 * sistema anterior (sin fila de encabezado; columna A = SKU, B =
 * Descripción, F = Unidad "UNI"/"KG").
 *
 * ADVERTENCIA: este importador es SÓLO de catálogo. El archivo de origen no
 * trae ninguna cantidad real de stock (las columnas numéricas vienen todas
 * en 0) — NUNCA toca `stock_sucursal`. Es upsert por SKU: crea productos
 * nuevos y actualiza descripción/unidad_venta de los existentes;
 * `peso_teorico_kg` no se pisa en el UPDATE (el Excel no trae peso, y no
 * queremos resetear a 0 un peso que ya se haya cargado a mano).
 *
 * Uso:
 *   npm run importar-productos -- --archivo=/ruta/Stock.xlsx [--hoja=Hoja2]
 */
import ExcelJS from 'exceljs';
import { pool } from '../src/config/db';
import { procesarFilasProductos, type FilaProductoCruda } from '../src/utils/productos.utils';

const COLUMNA_SKU = 1;
const COLUMNA_DESCRIPCION = 2;
const COLUMNA_UNIDAD = 6;

function leerArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function celda(valor: ExcelJS.CellValue): unknown {
  // ExcelJS puede devolver objetos ricos (fórmulas, richText); acá sólo nos
  // interesa el texto/número plano de columnas que en este archivo son
  // siempre literales.
  if (valor && typeof valor === 'object' && 'result' in valor) return (valor as { result: unknown }).result;
  return valor;
}

async function main(): Promise<void> {
  const { archivo, hoja = 'Hoja2' } = leerArgs();
  if (!archivo) {
    console.error('Uso: npm run importar-productos -- --archivo=/ruta/Stock.xlsx [--hoja=Hoja2]');
    process.exitCode = 1;
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(archivo);
  const worksheet = workbook.getWorksheet(hoja);
  if (!worksheet) {
    console.error(`No existe la hoja "${hoja}" en ${archivo}. Hojas disponibles: ${workbook.worksheets.map((w) => w.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const filas: FilaProductoCruda[] = [];
  worksheet.eachRow((row) => {
    filas.push({
      sku: celda(row.getCell(COLUMNA_SKU).value),
      descripcion: celda(row.getCell(COLUMNA_DESCRIPCION).value),
      unidad: celda(row.getCell(COLUMNA_UNIDAD).value),
    });
  });

  const { productos, filasOmitidas, skusDuplicados } = procesarFilasProductos(filas);

  if (skusDuplicados.length > 0) {
    console.warn(`SKUs duplicados en el archivo (se conservó la última aparición de cada uno): ${skusDuplicados.join(', ')}`);
  }

  let creados = 0;
  let actualizados = 0;
  for (const producto of productos) {
    const { rows } = await pool.query<{ insertado: boolean }>(
      `INSERT INTO productos (sku, descripcion, unidad_venta)
       VALUES ($1, $2, $3)
       ON CONFLICT (sku) DO UPDATE SET descripcion = EXCLUDED.descripcion, unidad_venta = EXCLUDED.unidad_venta
       RETURNING (xmax = 0) AS insertado`,
      [producto.sku, producto.descripcion, producto.unidad_venta],
    );
    if (rows[0].insertado) creados++;
    else actualizados++;
  }

  console.log(
    `Importación completa: ${creados} producto(s) nuevo(s), ${actualizados} actualizado(s), ${filasOmitidas} fila(s) omitida(s) (placeholders/basura del sistema anterior).`,
  );
  console.log('stock_sucursal no fue modificado: este archivo no trae cantidades reales de stock.');
  await pool.end();
}

main().catch((err) => {
  console.error('Error importando productos:', err);
  process.exitCode = 1;
});
