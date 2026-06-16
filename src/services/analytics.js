class AnalyticsService {
  constructor(db) {
    this.db = db;
  }

  async track(eventType, customerId = null, conversationId = null, productId = null, data = {}) {
    try {
      await this.db.query(
        `INSERT INTO analytics_events (event_type, customer_id, conversation_id, product_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventType, customerId, conversationId, productId, JSON.stringify(data)]
      );
    } catch (err) {
      console.error('[Analytics] Track error:', err.message);
    }
  }

  async getDashboardStats(period = '24h') {
    const interval = this.periodToInterval(period);

    const [conversations, messages, customers, events] = await Promise.all([
      this.db.query(
        `SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
          COUNT(CASE WHEN status = 'escalated' THEN 1 END) as escalated,
          AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))) as avg_duration_seconds
        FROM conversations
        WHERE started_at >= NOW() - $1::interval`,
        [interval]
      ),
      this.db.query(
        `SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN sender = 'customer' THEN 1 END) as from_customers,
          COUNT(CASE WHEN sender = 'assistant' THEN 1 END) as from_assistant
        FROM messages
        WHERE timestamp >= NOW() - $1::interval`,
        [interval]
      ),
      this.db.query(
        `SELECT
          COUNT(*) as new_customers,
          (SELECT COUNT(*) FROM customers) as total_customers
        FROM customers
        WHERE created_at >= NOW() - $1::interval`,
        [interval]
      ),
      this.db.query(
        `SELECT event_type, COUNT(*) as count
        FROM analytics_events
        WHERE created_at >= NOW() - $1::interval
        GROUP BY event_type`,
        [interval]
      )
    ]);

    const eventCounts = {};
    for (const row of events.rows) {
      eventCounts[row.event_type] = parseInt(row.count);
    }

    return {
      period,
      conversations: {
        total: parseInt(conversations.rows[0].total),
        active: parseInt(conversations.rows[0].active),
        resolved: parseInt(conversations.rows[0].resolved),
        escalated: parseInt(conversations.rows[0].escalated),
        avg_duration_minutes: Math.round((parseFloat(conversations.rows[0].avg_duration_seconds) || 0) / 60)
      },
      messages: {
        total: parseInt(messages.rows[0].total),
        from_customers: parseInt(messages.rows[0].from_customers),
        from_assistant: parseInt(messages.rows[0].from_assistant)
      },
      customers: {
        total: parseInt(customers.rows[0].total_customers),
        new: parseInt(customers.rows[0].new_customers)
      },
      events: eventCounts
    };
  }

  async getConversationTimeline(period = '7d') {
    const interval = this.periodToInterval(period);
    const { rows } = await this.db.query(
      `SELECT
        DATE_TRUNC('hour', started_at) as hour,
        COUNT(*) as conversations
      FROM conversations
      WHERE started_at >= NOW() - $1::interval
      GROUP BY hour
      ORDER BY hour`,
      [interval]
    );
    return rows;
  }

  async getMessageTimeline(period = '7d') {
    const interval = this.periodToInterval(period);
    const { rows } = await this.db.query(
      `SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        COUNT(CASE WHEN sender = 'customer' THEN 1 END) as incoming,
        COUNT(CASE WHEN sender = 'assistant' THEN 1 END) as outgoing
      FROM messages
      WHERE timestamp >= NOW() - $1::interval
      GROUP BY hour
      ORDER BY hour`,
      [interval]
    );
    return rows;
  }

  async getTopProducts(period = '30d', limit = 10) {
    const interval = this.periodToInterval(period);
    const { rows } = await this.db.query(
      `SELECT p.id, p.name, p.brand, p.price, p.stock, COUNT(ae.id) as inquiries
       FROM analytics_events ae
       JOIN products p ON ae.product_id = p.id
       WHERE ae.created_at >= NOW() - $1::interval
       AND ae.event_type IN ('product_inquiry', 'product_recommended')
       GROUP BY p.id, p.name, p.brand, p.price, p.stock
       ORDER BY inquiries DESC
       LIMIT $2`,
      [interval, limit]
    );
    return rows;
  }

  async getResponseTimeStats(period = '7d') {
    const interval = this.periodToInterval(period);
    const { rows } = await this.db.query(
      `WITH customer_msgs AS (
        SELECT m.conversation_id, m.timestamp as customer_time,
          LEAD(m.timestamp) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as next_msg_time,
          LEAD(m.sender) OVER (PARTITION BY m.conversation_id ORDER BY m.timestamp) as next_sender
        FROM messages m
        WHERE m.sender = 'customer' AND m.timestamp >= NOW() - $1::interval
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (next_msg_time - customer_time))) as avg_seconds,
        MIN(EXTRACT(EPOCH FROM (next_msg_time - customer_time))) as min_seconds,
        MAX(EXTRACT(EPOCH FROM (next_msg_time - customer_time))) as max_seconds
      FROM customer_msgs
      WHERE next_sender = 'assistant'`,
      [interval]
    );
    return rows[0];
  }

  async getSatisfactionStats(period = '30d') {
    const interval = this.periodToInterval(period);
    const { rows } = await this.db.query(
      `SELECT
        AVG(satisfaction_score) as avg_score,
        COUNT(CASE WHEN satisfaction_score >= 4 THEN 1 END) as positive,
        COUNT(CASE WHEN satisfaction_score = 3 THEN 1 END) as neutral,
        COUNT(CASE WHEN satisfaction_score <= 2 THEN 1 END) as negative,
        COUNT(satisfaction_score) as total_rated
      FROM conversations
      WHERE started_at >= NOW() - $1::interval AND satisfaction_score IS NOT NULL`,
      [interval]
    );
    return rows[0];
  }

  periodToInterval(period) {
    const map = {
      '1h': '1 hour', '6h': '6 hours', '12h': '12 hours',
      '24h': '24 hours', '7d': '7 days', '30d': '30 days',
      '90d': '90 days', '1y': '1 year'
    };
    return map[period] || '24 hours';
  }
}

module.exports = AnalyticsService;
