const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/stats', async (req, res) => {
  try {
    const period = req.query.period || '24h';
    const stats = await req.services.analytics.getDashboardStats(period);

    const waStatus = req.services.whatsapp?.getStatus() || 'disconnected';
    const waInfo = req.services.whatsapp?.getInfo();

    stats.whatsapp = { status: waStatus, ...waInfo };

    const inventoryStats = await req.services.inventory.getInventoryStats();
    stats.inventory = inventoryStats;

    res.json(stats);
  } catch (err) {
    console.error('[Dashboard] Stats error:', err);
    res.status(500).json({ error: 'Error cargando estadísticas' });
  }
});

router.get('/timeline/conversations', async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const data = await req.services.analytics.getConversationTimeline(period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando timeline' });
  }
});

router.get('/timeline/messages', async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const data = await req.services.analytics.getMessageTimeline(period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando timeline' });
  }
});

router.get('/top-products', async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const limit = parseInt(req.query.limit) || 10;
    const data = await req.services.analytics.getTopProducts(period, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando top productos' });
  }
});

router.get('/response-time', async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const data = await req.services.analytics.getResponseTimeStats(period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando tiempos de respuesta' });
  }
});

router.get('/satisfaction', async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const data = await req.services.analytics.getSatisfactionStats(period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando satisfacción' });
  }
});

router.get('/low-stock', async (req, res) => {
  try {
    const data = await req.services.inventory.getLowStockProducts();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando stock bajo' });
  }
});

module.exports = router;
