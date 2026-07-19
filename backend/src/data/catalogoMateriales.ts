/**
 * Catálogo de hierros para el módulo F1 (Carga Unificada).
 *
 * No existe una tabla de materiales en el modelo de datos provisto, así que
 * se mantiene como catálogo estático en el backend. `peso_teorico_kg`
 * representa el peso teórico por unidad de medida (kg/metro o kg/unidad,
 * según `unidad`) usado para calcular los kilos automáticamente:
 *
 *   kilos = cantidad * peso_teorico_kg
 */
export interface MaterialCatalogo {
  id_material: string;
  descripcion: string;
  unidad: 'metro' | 'unidad';
  peso_teorico_kg: number;
}

export const CATALOGO_MATERIALES: MaterialCatalogo[] = [
  { id_material: 'HRR-6', descripcion: 'Hierro Redondo Liso 6mm', unidad: 'metro', peso_teorico_kg: 0.222 },
  { id_material: 'HRR-8', descripcion: 'Hierro Redondo Liso 8mm', unidad: 'metro', peso_teorico_kg: 0.395 },
  { id_material: 'HRR-10', descripcion: 'Hierro Redondo Liso 10mm', unidad: 'metro', peso_teorico_kg: 0.617 },
  { id_material: 'HRA-8', descripcion: 'Hierro Redondo Aletado (ADN420) 8mm', unidad: 'metro', peso_teorico_kg: 0.395 },
  { id_material: 'HRA-10', descripcion: 'Hierro Redondo Aletado (ADN420) 10mm', unidad: 'metro', peso_teorico_kg: 0.617 },
  { id_material: 'HRA-12', descripcion: 'Hierro Redondo Aletado (ADN420) 12mm', unidad: 'metro', peso_teorico_kg: 0.888 },
  { id_material: 'HRA-16', descripcion: 'Hierro Redondo Aletado (ADN420) 16mm', unidad: 'metro', peso_teorico_kg: 1.578 },
  { id_material: 'CAI-20', descripcion: 'Caño Estructural Cuadrado 20x20x1.2mm', unidad: 'metro', peso_teorico_kg: 0.69 },
  { id_material: 'CAI-30', descripcion: 'Caño Estructural Cuadrado 30x30x1.5mm', unidad: 'metro', peso_teorico_kg: 1.32 },
  { id_material: 'PLC-3', descripcion: 'Chapa Lisa Negra 3mm (1.20 x 2.40)', unidad: 'unidad', peso_teorico_kg: 67.85 },
  { id_material: 'PLC-4', descripcion: 'Chapa Lisa Negra 4mm (1.20 x 2.40)', unidad: 'unidad', peso_teorico_kg: 90.43 },
  { id_material: 'PNU-80', descripcion: 'Perfil Ángulo Nervurado 80x80x6mm', unidad: 'metro', peso_teorico_kg: 7.34 },
];
