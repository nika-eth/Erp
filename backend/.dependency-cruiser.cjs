/**
 * Firewall lógico entre Operación INTERNA y AFIP: `emisorInterno.ts` (el
 * único emisor que corre para comprobantes internos, ver
 * `src/services/emision/`) no puede depender, ni siquiera transitivamente,
 * de nada bajo `src/afip/` (el Web Service AFIP). Esto convierte el
 * requisito de negocio "Operación INTERNA nunca toca AFIP" en algo que CI
 * verifica en cada push, no sólo una convención de código.
 */
module.exports = {
  forbidden: [
    {
      name: 'interno-no-depende-de-afip',
      severity: 'error',
      comment:
        'emisorInterno.ts (Operación INTERNA) no puede importar nada bajo src/afip/ — ese es el firewall lógico con el Web Service AFIP.',
      from: { path: '^src/services/emision/emisorInterno\\.ts$' },
      to: { path: '^src/afip/', reachable: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^test/' },
  },
};
