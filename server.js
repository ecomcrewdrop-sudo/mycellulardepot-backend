require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const db = require('./src/config/database');
const WhatsAppService = require('./src/services/whatsapp');
const AIEngine = require('./src/services/ai-engine');
const CRMService = require('./src/services/crm');
const InventoryService = require('./src/services/inventory');
const Humanizer = require('./src/services/humanizer');
const AnalyticsService = require('./src/services/analytics');

const apiRoutes = require('./src/routes/api');
const dashboardRoutes = require('./src/routes/dashboard');
const crmRoutes = require('./src/routes/crm');
const inventoryRoutes = require('./src/routes/inventory');
const settingsRoutes = require('./src/routes/settings');
const conversationRoutes = require('./src/routes/conversations');
const authRoutes = require('./src/routes/auth');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const services = {
  db,
  io,
  whatsapp: null,
  ai: new AIEngine(db),
  crm: new CRMService(db),
  inventory: new InventoryService(db),
  humanizer: new Humanizer(),
  analytics: new AnalyticsService(db),
};

app.use((req, _res, next) => {
  req.services = services;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api', apiRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    whatsapp: services.whatsapp?.getStatus() || 'not_initialized',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ── Socket.IO ──
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('request-qr', () => {
    if (services.whatsapp) {
      const qr = services.whatsapp.getLastQR();
      if (qr) socket.emit('qr', qr);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── WhatsApp Message Handler ──
async function handleIncomingMessage(message) {
  const { from, body, type, messageId } = message;
  const phone = from.replace('@c.us', '');

  try {
    let customer = await services.crm.findOrCreateCustomer(phone);
    let conversation = await services.crm.getActiveConversation(customer.id);

    if (!conversation) {
      conversation = await services.crm.createConversation(customer.id, phone);
      await services.analytics.track('conversation_started', customer.id, conversation.id);
    }

    await services.crm.saveMessage(conversation.id, 'customer', body, type, messageId);
    await services.analytics.track('message_received', customer.id, conversation.id);

    io.emit('new-message', {
      conversationId: conversation.id,
      customerId: customer.id,
      phone,
      customerName: customer.name || phone,
      content: body,
      sender: 'customer',
      timestamp: new Date().toISOString()
    });

    const config = await services.ai.getConfig();
    const escalationKeywords = JSON.parse(config.escalation_keywords || '[]');
    const needsEscalation = escalationKeywords.some(kw =>
      body.toLowerCase().includes(kw.toLowerCase())
    );

    if (needsEscalation) {
      await services.crm.escalateConversation(conversation.id);
      io.emit('escalation', { conversationId: conversation.id, phone, customerName: customer.name });
      await services.analytics.track('conversation_escalated', customer.id, conversation.id);

      const escalationMsg = 'Entiendo perfectamente. Voy a conectarte con uno de nuestros asesores para darte una atención más personalizada. Un momento por favor. 🙏';
      await sendHumanizedResponse(from, escalationMsg, conversation.id, customer.id);
      return;
    }

    const conversationHistory = await services.crm.getConversationMessages(conversation.id, 20);
    const inventory = await services.inventory.searchRelevantProducts(body);

    const aiResponse = await services.ai.generateResponse({
      message: body,
      customer,
      conversationHistory,
      inventory,
      config
    });

    await sendHumanizedResponse(from, aiResponse, conversation.id, customer.id);

  } catch (error) {
    console.error('[MSG] Error handling message:', error);
    await services.analytics.track('error', null, null, null, { error: error.message });
  }
}

async function sendHumanizedResponse(to, text, conversationId, customerId) {
  const readDelay = services.humanizer.getReadingDelay(text);
  await sleep(readDelay);

  await services.whatsapp.sendTyping(to);

  const thinkPause = services.humanizer.getThinkingPause();
  if (thinkPause > 0) await sleep(thinkPause);

  const typeDelay = services.humanizer.getTypingDelay(text);
  await sleep(typeDelay);

  await services.whatsapp.sendMessage(to, text);

  await services.crm.saveMessage(conversationId, 'assistant', text, 'text');
  await services.analytics.track('message_sent', customerId, conversationId);

  io.emit('new-message', {
    conversationId,
    customerId,
    content: text,
    sender: 'assistant',
    timestamp: new Date().toISOString()
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Start ──
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await db.query('SELECT 1');
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    console.log('[DB] Server starting without database - some features will be limited');
  }

  services.whatsapp = new WhatsAppService(io);
  services.whatsapp.onMessage(handleIncomingMessage);
  await services.whatsapp.initialize();

  server.listen(PORT, () => {
    console.log(`[SERVER] MyCellularDepot Assistant running on port ${PORT}`);
    console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch(err => {
  console.error('[SERVER] Fatal error:', err);
  process.exit(1);
});
