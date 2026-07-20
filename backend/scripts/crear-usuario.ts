/**
 * CLI de bootstrap: crea (o actualiza) un usuario en la tabla `usuarios`,
 * hasheando password y PIN de autorización con bcrypt. Necesario porque no
 * hay ningún flujo de alta de usuarios en la app todavía — sin esto no hay
 * forma de loguearse tras aplicar `sql/003_usuarios_auth.sql`.
 *
 * Uso:
 *   npm run crear-usuario -- --usuario=jperez --password=secreta123 \
 *     --nombre="Juan Perez" --rol=VENDEDOR --id_sucursal=1
 *
 *   npm run crear-usuario -- --usuario=supervisor1 --password=otraClave \
 *     --nombre="Ana Gómez" --rol=SUPERVISOR --id_sucursal=1 --pin=4821
 *
 * Si el `usuario` ya existe, actualiza nombre/password/rol/sucursal/pin
 * (UPSERT), útil para resetear una contraseña.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db';

const ROLES_VALIDOS = ['ADMIN', 'SUPERVISOR', 'VENDEDOR'];
const SALT_ROUNDS = 10;

function leerArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main(): Promise<void> {
  const args = leerArgs();
  const { usuario, password, nombre, rol, id_sucursal, pin } = args;

  if (!usuario || !password || !nombre || !rol || !id_sucursal) {
    console.error(
      'Uso: npm run crear-usuario -- --usuario=<user> --password=<pass> --nombre="<Nombre>" ' +
        '--rol=ADMIN|SUPERVISOR|VENDEDOR --id_sucursal=<id> [--pin=1234]',
    );
    process.exitCode = 1;
    return;
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    console.error(`rol inválido: ${rol}. Debe ser uno de ${ROLES_VALIDOS.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  if (pin && !/^\d{4}$/.test(pin)) {
    console.error('--pin debe ser numérico de 4 dígitos.');
    process.exitCode = 1;
    return;
  }
  if ((rol === 'SUPERVISOR' || rol === 'ADMIN') && !pin) {
    console.warn(`Aviso: usuario con rol ${rol} sin --pin; no podrá autorizar overrides de crédito en mostrador.`);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const pinHash = pin ? await bcrypt.hash(pin, SALT_ROUNDS) : null;

  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, usuario, password_hash, pin_autorizacion_hash, rol, id_sucursal, activo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (usuario) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           password_hash = EXCLUDED.password_hash,
           pin_autorizacion_hash = EXCLUDED.pin_autorizacion_hash,
           rol = EXCLUDED.rol,
           id_sucursal = EXCLUDED.id_sucursal,
           activo = TRUE
     RETURNING id_usuario, usuario, nombre, rol, id_sucursal`,
    [nombre, usuario, passwordHash, pinHash, rol, Number(id_sucursal)],
  );

  console.log('Usuario creado/actualizado:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error('Error creando el usuario:', err);
  process.exitCode = 1;
});
