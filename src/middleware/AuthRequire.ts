import { NextFunction, Request, Response } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  //console.log('Hit Auth Check');
  if (!req.session.isLoggedIn) {
    res.sendStatus(401);
    return;
  }
  next();
}
