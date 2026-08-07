const { timingSafeEqual } = require('crypto');

const TOKEN = process.env.SERVICE_TOKEN;
const TOKEN_BUF = Buffer.from(TOKEN || '', 'utf-8');

module.exports = function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Token autentikasi tidak valid atau tidak ada',
    });
  }

  const provided = Buffer.from(auth.slice(7), 'utf-8');

  if (provided.length !== TOKEN_BUF.length || !timingSafeEqual(provided, TOKEN_BUF)) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Token autentikasi tidak valid',
    });
  }

  next();
};
