const router = require('express').Router();
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { parseExcelBuffer } = require('../utils/excel-parser');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos Excel (.xlsx, .xls) o CSV'));
    }
  }
});

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { page, limit, search, category, brand, active } = req.query;
    const data = await req.services.inventory.getAllProducts({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      search: search || '',
      category: category || '',
      brand: brand || '',
      active: active !== undefined ? active === 'true' : null
    });
    res.json(data);
  } catch (err) {
    console.error('[Inventory] List error:', err);
    res.status(500).json({ error: 'Error cargando inventario' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await req.services.inventory.getInventoryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando stats' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const data = await req.services.inventory.getCategories();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando categorías' });
  }
});

router.get('/brands', async (req, res) => {
  try {
    const data = await req.services.inventory.getBrands();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando marcas' });
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

router.get('/:id', async (req, res) => {
  try {
    const product = await req.services.inventory.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Error cargando producto' });
  }
});

router.post('/', async (req, res) => {
  try {
    const product = await req.services.inventory.createProduct(req.body);
    req.services.io.emit('inventory-update', { type: 'created', product });
    res.status(201).json(product);
  } catch (err) {
    console.error('[Inventory] Create error:', err);
    res.status(500).json({ error: 'Error creando producto' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const product = await req.services.inventory.updateProduct(req.params.id, req.body);
    req.services.io.emit('inventory-update', { type: 'updated', product });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando producto' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await req.services.inventory.deleteProduct(req.params.id);
    req.services.io.emit('inventory-update', { type: 'deleted', id: req.params.id });
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando producto' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

    const parsed = parseExcelBuffer(req.file.buffer);

    if (parsed.products.length === 0) {
      return res.status(400).json({ error: 'No se encontraron productos en el archivo' });
    }

    if (req.query.preview === 'true') {
      return res.json({
        preview: true,
        totalRows: parsed.totalRows,
        productsFound: parsed.products.length,
        mapping: parsed.mapping,
        unmappedHeaders: parsed.unmappedHeaders,
        sampleProducts: parsed.products.slice(0, 5)
      });
    }

    const results = await req.services.inventory.bulkUpsertFromExcel(parsed.products);
    req.services.io.emit('inventory-update', { type: 'bulk_upload', ...results });

    res.json({
      message: 'Inventario actualizado',
      ...results,
      totalProcessed: parsed.products.length
    });
  } catch (err) {
    console.error('[Inventory] Upload error:', err);
    res.status(500).json({ error: 'Error procesando archivo' });
  }
});

module.exports = router;
