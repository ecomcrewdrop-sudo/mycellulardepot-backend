const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/customers', async (req, res) => {
  try {
    const { page, limit, search, tag } = req.query;
    const data = await req.services.crm.getAllCustomers({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      search: search || '',
      tag: tag || ''
    });
    res.json(data);
  } catch (err) {
    console.error('[CRM] List customers error:', err);
    res.status(500).json({ error: 'Error cargando clientes' });
  }
});

router.get('/customers/:id', async (req, res) => {
  try {
    const customer = await req.services.crm.getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

    const stats = await req.services.crm.getCustomerStats(req.params.id);
    const conversations = await req.services.crm.getAllConversations({
      page: 1,
      limit: 10,
      status: ''
    });

    res.json({
      ...customer,
      stats,
      recent_conversations: conversations.conversations.filter(
        c => c.customer_id === parseInt(req.params.id)
      )
    });
  } catch (err) {
    res.status(500).json({ error: 'Error cargando cliente' });
  }
});

router.put('/customers/:id', async (req, res) => {
  try {
    const customer = await req.services.crm.updateCustomer(req.params.id, req.body);
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando cliente' });
  }
});

router.post('/customers/:id/tags', async (req, res) => {
  try {
    const { tag } = req.body;
    const customer = await req.services.crm.getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

    const tags = customer.tags || [];
    if (!tags.includes(tag)) tags.push(tag);
    const updated = await req.services.crm.updateCustomer(req.params.id, { tags });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error agregando tag' });
  }
});

router.delete('/customers/:id/tags/:tag', async (req, res) => {
  try {
    const customer = await req.services.crm.getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

    const tags = (customer.tags || []).filter(t => t !== req.params.tag);
    const updated = await req.services.crm.updateCustomer(req.params.id, { tags });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando tag' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { rows } = await req.services.db.query(
      `SELECT
        COUNT(*) as total_customers,
        COUNT(CASE WHEN 'VIP' = ANY(tags) THEN 1 END) as vip_customers,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_this_week,
        COUNT(CASE WHEN last_contact >= NOW() - INTERVAL '24 hours' THEN 1 END) as active_today,
        COALESCE(AVG(total_purchases), 0) as avg_purchases
      FROM customers`
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando stats CRM' });
  }
});

module.exports = router;
