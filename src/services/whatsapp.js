const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

class WhatsAppService {
  constructor(io) {
    this.io = io;
    this.client = null;
    this.status = 'disconnected';
    this.lastQR = null;
    this.messageHandler = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.connectedPhone = null;
    this.readyTimestamp = null;
  }

  async initialize() {
    console.log('[WA] Initializing WhatsApp client...');

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './wa-session' }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
          '--single-process'
        ]
      },
      webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/niclasbussenern/niclasbussenern/refs/heads/main/niclasbussenern.json' }
    });

    this.client.on('qr', async (qr) => {
      console.log('[WA] QR code received');
      this.status = 'waiting_qr';
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        this.lastQR = qrDataUrl;
        this.io.emit('qr', qrDataUrl);
        this.io.emit('wa-status', { status: 'waiting_qr' });
      } catch (err) {
        console.error('[WA] QR generation error:', err);
      }
    });

    this.client.on('ready', () => {
      console.log('[WA] Client is ready!');
      this.status = 'connected';
      this.readyTimestamp = Math.floor(Date.now() / 1000);
      this.lastQR = null;
      this.reconnectAttempts = 0;
      this.connectedPhone = this.client.info?.wid?.user || null;
      this.io.emit('wa-status', {
        status: 'connected',
        phone: this.connectedPhone,
        name: this.client.info?.pushname || null
      });
    });

    this.client.on('authenticated', () => {
      console.log('[WA] Authenticated');
      this.status = 'authenticated';
      this.io.emit('wa-status', { status: 'authenticated' });
    });

    this.client.on('auth_failure', (msg) => {
      console.error('[WA] Auth failure:', msg);
      this.status = 'auth_failed';
      this.io.emit('wa-status', { status: 'auth_failed', error: msg });
    });

    this.client.on('disconnected', (reason) => {
      console.log('[WA] Disconnected:', reason);
      this.status = 'disconnected';
      this.connectedPhone = null;
      this.io.emit('wa-status', { status: 'disconnected', reason });
      this.attemptReconnect();
    });

    this.client.on('message', async (msg) => {
      if (msg.from === 'status@broadcast') return;
      if (msg.fromMe) return;
      if (msg.isStatus) return;

      // Ignore old messages from before the system was ready
      if (this.readyTimestamp && msg.timestamp < this.readyTimestamp) return;

      // Ignore group messages
      if (msg.from.endsWith('@g.us')) return;

      // Extract clean phone number
      const contact = await msg.getContact();
      const phone = this.extractPhone(msg.from, contact);
      const contactName = contact?.pushname || contact?.name || null;

      if (this.messageHandler) {
        try {
          await this.messageHandler({
            from: msg.from,
            phone,
            contactName,
            body: msg.body || '',
            type: msg.type,
            messageId: msg.id._serialized,
            hasMedia: msg.hasMedia,
            timestamp: msg.timestamp
          });
        } catch (err) {
          console.error('[WA] Message handler error:', err);
        }
      }
    });

    this.client.on('message_ack', (msg, ack) => {
      this.io.emit('message-ack', {
        messageId: msg.id._serialized,
        ack
      });
    });

    try {
      await this.client.initialize();
    } catch (err) {
      console.error('[WA] Initialization error:', err);
      this.status = 'error';
      this.io.emit('wa-status', { status: 'error', error: err.message });
    }
  }

  extractPhone(waId, contact) {
    // Try to get number from contact first
    if (contact?.number) return contact.number;

    // Clean the WhatsApp ID
    let phone = waId
      .replace('@c.us', '')
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .replace('@g.us', '');

    // If it looks like a real phone number (digits only, 7-15 chars), use it
    if (/^\d{7,15}$/.test(phone)) return phone;

    // Fallback
    return phone;
  }

  async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WA] Max reconnect attempts reached');
      this.io.emit('wa-status', { status: 'failed', error: 'Max reconnect attempts reached' });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(5000 * this.reconnectAttempts, 60000);
    console.log(`[WA] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (err) {
        console.error('[WA] Reconnect failed:', err);
      }
    }, delay);
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  async sendMessage(to, content) {
    if (!this.client || this.status !== 'connected') {
      throw new Error('WhatsApp client not connected');
    }
    const chatId = to.includes('@') ? to : `${to}@c.us`;
    return this.client.sendMessage(chatId, content);
  }

  async sendTyping(to) {
    if (!this.client || this.status !== 'connected') return;
    try {
      const chatId = to.includes('@') ? to : `${to}@c.us`;
      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
    } catch (err) {
      console.error('[WA] Typing indicator error:', err);
    }
  }

  async stopTyping(to) {
    if (!this.client || this.status !== 'connected') return;
    try {
      const chatId = to.includes('@') ? to : `${to}@c.us`;
      const chat = await this.client.getChatById(chatId);
      await chat.clearState();
    } catch (err) {
      // Silently ignore
    }
  }

  getStatus() {
    return this.status;
  }

  getLastQR() {
    return this.lastQR;
  }

  getInfo() {
    if (!this.client?.info) return null;
    return {
      phone: this.client.info.wid?.user,
      name: this.client.info.pushname,
      platform: this.client.info.platform
    };
  }

  async logout() {
    if (this.client) {
      try {
        await this.client.logout();
        this.status = 'disconnected';
        this.connectedPhone = null;
        this.lastQR = null;
        this.io.emit('wa-status', { status: 'disconnected' });
      } catch (err) {
        console.error('[WA] Logout error:', err);
      }
    }
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }
}

module.exports = WhatsAppService;
