const XLSX = require('xlsx');

const COLUMN_MAP = {
  sku: ['sku', 'codigo', 'código', 'code', 'ref', 'referencia', 'id_producto'],
  name: ['name', 'nombre', 'producto', 'product', 'titulo', 'título', 'descripcion_corta', 'item'],
  brand: ['brand', 'marca', 'fabricante', 'manufacturer'],
  category: ['category', 'categoria', 'categoría', 'tipo', 'type', 'linea', 'línea'],
  description: ['description', 'descripcion', 'descripción', 'detalle', 'detail', 'info'],
  price: ['price', 'precio', 'precio_venta', 'sale_price', 'valor', 'pvp'],
  compare_price: ['compare_price', 'precio_anterior', 'precio_lista', 'msrp', 'precio_regular', 'list_price'],
  cost: ['cost', 'costo', 'precio_costo', 'precio_compra'],
  stock: ['stock', 'cantidad', 'qty', 'quantity', 'inventario', 'existencia', 'disponible', 'unidades'],
  condition: ['condition', 'condicion', 'condición', 'estado', 'state'],
  color: ['color', 'colour'],
  storage: ['storage', 'almacenamiento', 'capacidad', 'memory', 'memoria', 'gb', 'ram'],
  image_url: ['image', 'imagen', 'image_url', 'img', 'foto', 'photo', 'url_imagen'],
};

function normalizeHeader(header) {
  return String(header).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function mapColumns(headers) {
  const mapping = {};
  const normalized = headers.map(normalizeHeader);

  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx !== -1) {
      mapping[field] = headers[idx];
    }
  }
  return mapping;
}

function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rawData.length === 0) return { products: [], mapping: {}, totalRows: 0 };

  const headers = Object.keys(rawData[0]);
  const mapping = mapColumns(headers);

  const products = rawData.map(row => {
    const product = {};

    for (const [field, originalHeader] of Object.entries(mapping)) {
      let value = row[originalHeader];

      if (field === 'price' || field === 'compare_price' || field === 'cost') {
        value = parseFloat(String(value).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      } else if (field === 'stock') {
        value = parseInt(String(value).replace(/[^0-9]/g, '')) || 0;
      } else if (field === 'condition') {
        const v = String(value).toLowerCase();
        if (v.includes('nuevo') || v.includes('new')) value = 'new';
        else if (v.includes('reacond') || v.includes('refurb')) value = 'refurbished';
        else if (v.includes('usado') || v.includes('used')) value = 'used';
        else value = 'new';
      } else {
        value = String(value).trim();
      }

      product[field] = value;
    }

    const unmapped = {};
    for (const header of headers) {
      const isMapped = Object.values(mapping).includes(header);
      if (!isMapped && row[header]) {
        unmapped[normalizeHeader(header)] = row[header];
      }
    }
    if (Object.keys(unmapped).length > 0) {
      product.specs = unmapped;
    }

    return product;
  }).filter(p => p.name);

  return {
    products,
    mapping,
    totalRows: rawData.length,
    sheetName,
    unmappedHeaders: headers.filter(h => !Object.values(mapping).includes(h))
  };
}

module.exports = { parseExcelBuffer, normalizeHeader, mapColumns };
