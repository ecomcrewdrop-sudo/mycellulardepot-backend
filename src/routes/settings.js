const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { rows } = await req.services.db.query('SELECT key, value FROM assistant_config');
    const config = {};
    for (const row of rows) {
      config[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    }
    res.json(config);
  } catch (err) {
    console.error('[Settings] Get error:', err);
    res.status(500).json({ error: 'Error cargando configuración' });
  }
});

router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await req.services.db.query(
        `INSERT INTO assistant_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }

    req.services.ai.invalidateConfigCache();
    res.json({ message: 'Configuración actualizada' });
  } catch (err) {
    console.error('[Settings] Update error:', err);
    res.status(500).json({ error: 'Error actualizando configuración' });
  }
});

router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await req.services.db.query(
      `INSERT INTO assistant_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [req.params.key, JSON.stringify(value)]
    );

    req.services.ai.invalidateConfigCache();
    res.json({ message: `${req.params.key} actualizado` });
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando configuración' });
  }
});

router.get('/templates', async (req, res) => {
  try {
    const { rows } = await req.services.db.query(
      'SELECT * FROM templates ORDER BY category, name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando templates' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, category, content, variables } = req.body;
    const { rows } = await req.services.db.query(
      `INSERT INTO templates (name, category, content, variables)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, category || 'general', content, variables || []]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error creando template' });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const { name, category, content, variables, active } = req.body;
    const { rows } = await req.services.db.query(
      `UPDATE templates SET name = COALESCE($2, name), category = COALESCE($3, category),
       content = COALESCE($4, content), variables = COALESCE($5, variables),
       active = COALESCE($6, active)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, category, content, variables, active]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando template' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await req.services.db.query('DELETE FROM templates WHERE id = $1', [req.params.id]);
    res.json({ message: 'Template eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando template' });
  }
});

router.get('/whatsapp/status', async (req, res) => {
  try {
    const status = req.services.whatsapp?.getStatus() || 'not_initialized';
    const info = req.services.whatsapp?.getInfo();
    res.json({ status, ...info });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo status de WhatsApp' });
  }
});

router.post('/whatsapp/logout', async (req, res) => {
  try {
    await req.services.whatsapp?.logout();
    res.json({ message: 'WhatsApp desconectado' });
  } catch (err) {
    res.status(500).json({ error: 'Error desconectando WhatsApp' });
  }
});

module.exports = router;
