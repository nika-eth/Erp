import type { UserPayload } from './domain';

declare global {
  namespace Express {
    interface Request {
      /** Poblado por `authenticateJWT`. */
      user?: UserPayload;
      /**
       * Poblado por `verifySupervisorOverride` cuando el request trae un
       * `x-supervisor-pin` válido. La presencia de este campo es lo que le
       * indica a `ventas.service.ts` que debe saltear el límite de crédito
       * (`SET LOCAL app.allow_credit_override`) y auditar la autorización.
       */
      supervisorAutorizacion?: { id_supervisor: number; nombreSupervisor: string };
    }
  }
}

export {};
