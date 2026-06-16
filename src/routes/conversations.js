const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const data = await req.services.crm.getAllConversations({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 30,
      status: status || ''
    });
    res.json(data);
  } catch (err) {
    console.error('[Conversations] List error:', err);
    res.status(500).json({ error: 'Error cargando conversaciones' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await req.services.db.query(
      `SELECT c.*, cu.name as customer_name, cu.phone as customer_phone, cu.tags as customer_tags
       FROM conversations c
       LEFT JOIN customers cu ON c.customer_id = cu.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conversación no encontrada' });

    const messages = await req.services.crm.getConversationMessages(req.params.id, 100);
    res.json({ ...rows[0], messages });
  } catch (err) {
    res.status(500).json({ error: 'Error cargando conversación' });
  }
});

router.post('/:id/resolve', async (req, res) => {
  try {
    const { summary } = req.body;
    await req.services.crm.resolveConversation(req.params.id, summary || '');
    req.services.io.emit('conversation-update', {
      id: parseInt(req.params.id),
      status: 'resolved'
    });
    res.json({ message: 'Conversación resuelta' });
  } catch (err) {
    res.status(500).json({ error: 'Error resolviendo conversación' });
  }
});

router.post('/:id/escalate', async (req, res) => {
  try {
    await req.services.crm.escalateConversation(req.params.id);
    req.services.io.emit('conversation-update', {
      id: parseInt(req.params.id),
      status: 'escalated'
    });
    res.json({ message: 'Conversación escalada' });
  } catch (err) {
    res.status(500).json({ error: 'Error escalando conversación' });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    const { rows } = await req.services.db.query(
      'SELECT phone FROM conversations WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Conversación no encontrada' });

    const phone = rows[0].phone;
    await req.services.whatsapp.sendMessage(phone, message);
    await req.services.crm.saveMessage(req.params.id, 'assistant', message, 'text');

    req.services.io.emit('new-message', {
      conversationId: parseInt(req.params.id),
      content: message,
      sender: 'assistant',
      manual: true,
      timestamp: new Date().toISOString()
    });

    res.json({ message: 'Mensaje enviado' });
  } catch (err) {
    console.error('[Conversations] Send error:', err);
    res.status(500).json({ error: 'Error enviando mensaje' });
  }
});

router.delete('/cleanup/old', async (req, res) => {
  try {
    const { rows: convRows } = await req.services.db.query(
      `DELETE FROM conversations WHERE phone LIKE '%@lid%' OR phone LIKE '%@g.us%' RETURNING id`
    );

    const { rows: custRows } = await req.services.db.query(
      `DELETE FROM customers WHERE phone LIKE '%@lid%' OR phone LIKE '%@g.us%' OR phone LIKE '%:%' RETURNING id`
    );

    res.json({
      message: 'Datos antiguos eliminados',
      conversationsDeleted: convRows.length,
      customersDeleted: custRows.length
    });
  } catch (err) {
    console.error('[Conversations] Cleanup error:', err);
    res.status(500).json({ error: 'Error limpiando datos' });
  }
});

module.exports = router;
