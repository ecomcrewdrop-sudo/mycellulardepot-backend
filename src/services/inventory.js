class InventoryService {
  constructor(db) {
    this.db = db;
  }

  async getAllProducts({ page = 1, limit = 50, search = '', category = '', brand = '', active = null } = {}) {
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR brand ILIKE $${params.length} OR sku ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    if (category) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    if (brand) {
      params.push(brand);
      where += ` AND brand = $${params.length}`;
    }
    if (active !== null) {
      params.push(active);
      where += ` AND active = $${params.length}`;
    }

    const countResult = await this.db.query(`SELECT COUNT(*) FROM products ${where}`, params);

    params.push(limit, offset);
    const { rows } = await this.db.query(
      `SELECT * FROM products ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      products: rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    };
  }

  async getProduct(id) {
    const { rows } = await this.db.query('SELECT * FROM products WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async createProduct(data) {
    const { rows } = await this.db.query(
      `INSERT INTO products (sku, name, brand, category, description, price, compare_price, cost, stock, min_stock, condition, color, storage, specs, image_url, active, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [data.sku, data.name, data.brand, data.category, data.description,
       data.price, data.compare_price, data.cost, data.stock || 0, data.min_stock || 2,
       data.condition || 'new', data.color, data.storage, JSON.stringify(data.specs || {}),
       data.image_url, data.active !== false, data.featured || false]
    );
    return rows[0];
  }

  async updateProduct(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['sku','name','brand','category','description','price','compare_price',
      'cost','stock','min_stock','condition','color','storage','specs','image_url','active','featured'];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(key === 'specs' ? JSON.stringify(data[key]) : data[key]);
        idx++;
      }
    }

    if (fields.length === 0) return this.getProduct(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  }

  async deleteProduct(id) {
    await this.db.query('DELETE FROM products WHERE id = $1', [id]);
  }

  async searchRelevantProducts(query, limit = 8) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) {
      const { rows } = await this.db.query(
        'SELECT * FROM products WHERE active = TRUE AND stock > 0 ORDER BY featured DESC, updated_at DESC LIMIT $1',
        [limit]
      );
      return rows;
    }

    const conditions = words.map((_, i) => (
      `(LOWER(name) LIKE $${i + 1} OR LOWER(brand) LIKE $${i + 1} OR LOWER(category) LIKE $${i + 1} OR LOWER(description) LIKE $${i + 1} OR LOWER(color) LIKE $${i + 1} OR LOWER(storage) LIKE $${i + 1})`
    ));
    const params = words.map(w => `%${w}%`);
    params.push(limit);

    const { rows } = await this.db.query(
      `SELECT *, (
        ${words.map((_, i) => `(CASE WHEN LOWER(name) LIKE $${i + 1} THEN 3 ELSE 0 END + CASE WHEN LOWER(brand) LIKE $${i + 1} THEN 2 ELSE 0 END + CASE WHEN LOWER(category) LIKE $${i + 1} THEN 1 ELSE 0 END)`).join(' + ')}
      ) as relevance
      FROM products
      WHERE active = TRUE AND (${conditions.join(' OR ')})
      ORDER BY relevance DESC, stock DESC, featured DESC
      LIMIT $${params.length}`,
      params
    );

    return rows;
  }

  async bulkUpsertFromExcel(products) {
    const results = { created: 0, updated: 0, errors: [] };

    for (const product of products) {
      try {
        if (!product.name) {
          results.errors.push(`Producto sin nombre: ${JSON.stringify(product)}`);
          continue;
        }

        if (product.sku) {
          const existing = await this.db.query(
            'SELECT id FROM products WHERE sku = $1', [product.sku]
          );
          if (existing.rows.length > 0) {
            await this.updateProduct(existing.rows[0].id, product);
            results.updated++;
            continue;
          }
        }

        await this.createProduct(product);
        results.created++;
      } catch (err) {
        results.errors.push(`Error con "${product.name}": ${err.message}`);
      }
    }

    return results;
  }

  async getCategories() {
    const { rows } = await this.db.query(
      'SELECT DISTINCT category, COUNT(*) as count FROM products WHERE active = TRUE GROUP BY category ORDER BY count DESC'
    );
    return rows;
  }

  async getBrands() {
    const { rows } = await this.db.query(
      'SELECT DISTINCT brand, COUNT(*) as count FROM products WHERE active = TRUE GROUP BY brand ORDER BY count DESC'
    );
    return rows;
  }

  async getLowStockProducts() {
    const { rows } = await this.db.query(
      'SELECT * FROM products WHERE active = TRUE AND stock <= min_stock ORDER BY stock ASC'
    );
    return rows;
  }

  async getInventoryStats() {
    const { rows } = await this.db.query(
      `SELECT
        COUNT(*) as total_products,
        COUNT(CASE WHEN active = TRUE THEN 1 END) as active_products,
        COUNT(CASE WHEN stock = 0 AND active = TRUE THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN stock <= min_stock AND stock > 0 AND active = TRUE THEN 1 END) as low_stock,
        COALESCE(SUM(CASE WHEN active = TRUE THEN stock ELSE 0 END), 0) as total_units,
        COALESCE(SUM(CASE WHEN active = TRUE THEN price * stock ELSE 0 END), 0) as total_value
      FROM products`
    );
    return rows[0];
  }
}

module.exports = InventoryService;
