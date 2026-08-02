import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireToken(req, res, next) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !safeEqual(match[1].trim(), config.serviceToken)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}
