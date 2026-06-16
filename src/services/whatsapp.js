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
    this.qrExpireTimer = null;
    this.connectionStartTime = null;
    this.isInitializing = false;
  }

  async initialize() {
    if (this.isInitializing) {
      console.log('[WA] Already initializing, skipping...');
      return;
    }
    this.isInitializing = true;
    console.log('[WA] Initializing WhatsApp client...');

    if (this.client) {
      try { await this.client.destroy(); } catch {}
      this.client = null;
    }

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

      if (this.qrExpireTimer) clearTimeout(this.qrExpireTimer);
      this.qrExpireTimer = setTimeout(() => {
        if (this.status === 'waiting_qr') {
          console.log('[WA] QR expired, waiting for new one...');
          this.io.emit('wa-status', { status: 'qr_expired' });
        }
      }, 45000);

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
      this.connectionStartTime = Date.now();
      this.lastQR = null;
      this.reconnectAttempts = 0;
      this.isInitializing = false;
      if (this.qrExpireTimer) { clearTimeout(this.qrExpireTimer); this.qrExpireTimer = null; }
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
      this.isInitializing = false;
      this.io.emit('wa-status', { status: 'auth_failed', error: msg });
    });

    this.client.on('disconnected', (reason) => {
      console.log('[WA] Disconnected:', reason);
      this.status = 'disconnected';
      this.connectedPhone = null;
      this.isInitializing = false;
      this.io.emit('wa-status', { status: 'disconnected', reason });
      this.attemptReconnect();
    });

    this.client.on('message', async (msg) => {
      if (msg.from === 'status@broadcast') return;
      if (msg.fromMe) return;
      if (msg.isStatus) return;
      if (this.readyTimestamp && msg.timestamp < this.readyTimestamp) return;
      if (msg.from.endsWith('@g.us')) return;

      const contact = await msg.getContact();
      const phone = this.extractPhone(msg.from, contact);
      const contactName = contact?.pushname || contact?.name || null;

      let audioData = null;
      if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.data) {
            audioData = { base64: media.data, mimetype: media.mimetype };
          }
        } catch (err) {
          console.error('[WA] Audio download error:', err.message);
        }
      }

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
            timestamp: msg.timestamp,
            audioData
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
      this.isInitializing = false;
      this.io.emit('wa-status', { status: 'error', error: err.message });
    }
  }

  extractPhone(waId, contact) {
    if (contact?.number) return contact.number;

    let phone = waId
      .replace('@c.us', '')
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .replace('@g.us', '');

    if (/^\d{7,15}$/.test(phone)) return phone;
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
    } catch {}
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

  getConnectionHealth() {
    return {
      status: this.status,
      uptime: this.connectionStartTime ? Math.floor((Date.now() - this.connectionStartTime) / 1000) : 0,
      reconnectAttempts: this.reconnectAttempts,
      phone: this.connectedPhone,
      name: this.client?.info?.pushname || null,
      platform: this.client?.info?.platform || null,
    };
  }

  async restart() {
    console.log('[WA] Manual restart requested');
    this.reconnectAttempts = 0;
    if (this.client) {
      try { await this.client.destroy(); } catch {}
      this.client = null;
    }
    this.status = 'disconnected';
    this.connectedPhone = null;
    this.lastQR = null;
    this.isInitializing = false;
    this.io.emit('wa-status', { status: 'restarting' });
    await this.initialize();
  }

  async logout() {
    if (this.client) {
      try {
        await this.client.logout();
        this.status = 'disconnected';
        this.connectedPhone = null;
        this.lastQR = null;
        this.connectionStartTime = null;
        this.io.emit('wa-status', { status: 'disconnected' });
      } catch (err) {
        console.error('[WA] Logout error:', err);
      }
    }
  }

  async destroy() {
    if (this.qrExpireTimer) clearTimeout(this.qrExpireTimer);
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }
}

module.exports = WhatsAppService;
