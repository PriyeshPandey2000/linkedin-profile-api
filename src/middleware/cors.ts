// Minimal CORS support so the static landing page (public/index.html) can
// call the API from a different origin (e.g. the local static preview server,
// or a future separate frontend host). For a public API like this, allowing
// any origin is fine; the API is keyed by URL + cookie, not by browser origin.

import type { Request, Response, NextFunction } from 'express';

export default function cors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}
