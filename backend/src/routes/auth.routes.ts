import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { loginRateLimiter } from '../middleware/rateLimit';
import { postLogin } from '../controllers/auth.controller';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, asyncHandler(postLogin));
