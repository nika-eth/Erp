import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { postLogin } from '../controllers/auth.controller';

export const authRouter = Router();

authRouter.post('/login', asyncHandler(postLogin));
