class CRMService {
  constructor(db) {
    this.db = db;
  }

  async findOrCreateCustomer(phone) {
    const { rows } = await this.db.query(
      'SELECT * FROM customers WHERE phone = $1',
      [phone]
    );

    if (rows.length > 0) {
      await this.db.query(
        'UPDATE customers SET last_contact = NOW(), total_conversations = total_conversations + 0 WHERE id = $1',
        [rows[0].id]
      );
      return rows[0];
    }

    const { rows: newRows } = await this.db.query(
      `INSERT INTO customers (phone, first_contact, last_contact)
       VALUES ($1, NOW(), NOW())
       RETURNING *`,
      [phone]
    );
    return newRows[0];
  }

  async getCustomer(id) {
    const { rows } = await this.db.query('SELECT * FROM customers WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async getCustomerByPhone(phone) {
    const { rows } = await this.db.query('SELECT * FROM customers WHERE phone = $1', [phone]);
    return rows[0] || null;
  }

  async updateCustomer(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['name', 'email', 'tags', 'notes', 'preferred_language', 'metadata'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(key === 'tags' ? data[key] : data[key]);
        idx++;
      }
    }

    if (fields.length === 0) return this.getCustomer(id);

    values.push(id);
    const { rows } = await this.db.query(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  }

  async getAllCustomers({ page = 1, limit = 50, search = '', tag = '' } = {}) {
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    if (tag) {
      params.push(tag);
      where += ` AND $${params.length} = ANY(tags)`;
    }

    const countResult = await this.db.query(
      `SELECT COUNT(*) FROM customers ${where}`, params
    );

    params.push(limit, offset);
    const { rows } = await this.db.query(
      `SELECT * FROM customers ${where}
       ORDER BY last_contact DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      customers: rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    };
  }

  async getActiveConversation(customerId) {
    const { rows } = await this.db.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`,
      [customerId]
    );
    return rows[0] || null;
  }

  async createConversation(customerId, phone) {
    await this.db.query(
      'UPDATE customers SET total_conversations = total_conversations + 1, last_contact = NOW() WHERE id = $1',
      [customerId]
    );

    const { rows } = await this.db.query(
      `INSERT INTO conversations (customer_id, phone, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING *`,
      [customerId, phone]
    );
    return rows[0];
  }

  async saveMessage(conversationId, sender, content, messageType = 'text', waMessageId = null) {
    const { rows } = await this.db.query(
      `INSERT INTO messages (conversation_id, sender, content, message_type, wa_message_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [conversationId, sender, content, messageType, waMessageId]
    );
    return rows[0];
  }

  async getConversationMessages(conversationId, limit = 20) {
    const { rows } = await this.db.query(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY timestamp ASC
       LIMIT $2`,
      [conversationId, limit]
    );
    return rows;
  }

  async getAllConversations({ page = 1, limit = 30, status = '' } = {}) {
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];

    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }

    const countResult = await this.db.query(
      `SELECT COUNT(*) FROM conversations c ${where}`, params
    );

    params.push(limit, offset);
    const { rows } = await this.db.query(
      `SELECT c.*, cu.name as customer_name, cu.phone as customer_phone,
              (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message,
              (SELECT timestamp FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       LEFT JOIN customers cu ON c.customer_id = cu.id
       ${where}
       ORDER BY c.started_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      conversations: rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    };
  }

  async escalateConversation(conversationId) {
    await this.db.query(
      `UPDATE conversations SET status = 'escalated', escalated = TRUE WHERE id = $1`,
      [conversationId]
    );
  }

  async resolveConversation(conversationId, summary = '') {
    await this.db.query(
      `UPDATE conversations SET status = 'resolved', ended_at = NOW(), summary = $2 WHERE id = $1`,
      [conversationId, summary]
    );
  }

  async getCustomerStats(customerId) {
    const { rows: convRows } = await this.db.query(
      `SELECT COUNT(*) as total_conversations,
              COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
              COUNT(CASE WHEN status = 'escalated' THEN 1 END) as escalated
       FROM conversations WHERE customer_id = $1`,
      [customerId]
    );

    const { rows: msgRows } = await this.db.query(
      `SELECT COUNT(*) as total_messages
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE c.customer_id = $1`,
      [customerId]
    );

    const { rows: productRows } = await this.db.query(
      `SELECT DISTINCT unnest(products_discussed) as product_id
       FROM conversations WHERE customer_id = $1 AND products_discussed != '{}'`,
      [customerId]
    );

    return {
      ...convRows[0],
      total_messages: parseInt(msgRows[0].total_messages),
      products_interested: productRows.length
    };
  }
}

module.exports = CRMService;
