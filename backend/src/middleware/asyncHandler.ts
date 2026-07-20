import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Envuelve un handler async para que sus rechazos de Promise lleguen a
 * `errorHandler` en vez de quedar como unhandled rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
