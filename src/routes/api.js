const router = require('express').Router();

router.get('/status', (_req, res) => {
  res.json({
    service: 'MyCellularDepot Assistant API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
