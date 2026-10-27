const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const cmd = async a => {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: JSON.stringify(a) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
};
const get = async k => { const v = await cmd(['GET', k]); return v ? JSON.parse(v) : null; };
const set = (k, v) => cmd(['SET', k, JSON.stringify(v)]);
const str = (s, n) => String(s == null ? '' : s).slice(0, n);
const star = n => Number.isInteger(n) && n >= 1 && n <= 5;

module.exports = async (req, res) => {
  try {
    if (!U || !T) return res.status(500).json({ error: 'Database is not connected.' });
    const pw = process.env.ADMIN_PASSWORD;
    const admin = !!pw && req.headers['x-admin-password'] === pw;
    const meta = (await get('lrs:meta')) || { L: [], F: [], P: [] };
    let R = (await get('lrs:rev')) || [];

    if (req.method === 'GET')
      return res.status(200).json({ ...meta, R: admin ? R : R.filter(r => r.status === 'approved') });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    const b = req.body || {};
    if (b.action === 'review') {
      if (!meta.L.some(l => l.id === b.lid) || !star(b.t) || !star(b.c) || !star(b.s))
        return res.status(400).json({ error: 'Invalid review.' });
      if (R.length >= 5000) return res.status(429).json({ error: 'Review limit reached.' });
      R.push({
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        lid: b.lid, t: b.t, c: b.c, s: b.s, comment: str(b.comment, 400),
        date: new Date().toISOString().slice(0, 10), status: 'pending'
      });
      await set('lrs:rev', R);
      return res.status(200).json({ ok: true });
    }

    if (!pw) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
    if (!admin) return res.status(401).json({ error: 'Incorrect password.' });
    if (b.action === 'login') return res.status(200).json({ ok: true });

    if (b.action === 'meta') {
      if (![b.L, b.F, b.P].every(Array.isArray)) return res.status(400).json({ error: 'Invalid data.' });
      const m = { L: b.L, F: b.F, P: b.P };
      if (JSON.stringify(m).length > 900000)
        return res.status(413).json({ error: 'Too much data. Use smaller photos or fewer lecturers.' });
      const ids = new Set(m.L.map(l => l.id));
      await set('lrs:meta', m);
      await set('lrs:rev', R.filter(r => ids.has(r.lid)));
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'approve') {
      R = R.map(r => (r.id === b.id ? { ...r, status: 'approved' } : r));
      await set('lrs:rev', R);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'delreview') {
      await set('lrs:rev', R.filter(r => r.id !== b.id));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
