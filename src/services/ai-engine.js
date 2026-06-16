const OpenAI = require('openai');

class AIEngine {
  constructor(db) {
    this.db = db;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.configCache = null;
    this.configCacheTime = 0;
    this.CONFIG_TTL = 60000;
  }

  async getConfig() {
    if (this.configCache && Date.now() - this.configCacheTime < this.CONFIG_TTL) {
      return this.configCache;
    }
    try {
      const { rows } = await this.db.query('SELECT key, value FROM assistant_config');
      const config = {};
      for (const row of rows) {
        config[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      }
      this.configCache = config;
      this.configCacheTime = Date.now();
      return config;
    } catch {
      return this.configCache || {};
    }
  }

  buildSystemPrompt(config, inventory, customer) {
    const storeName = config.store_name || 'MyCellularDepot';
    const assistantName = config.assistant_name || 'Alex';
    const personality = config.assistant_personality || '';
    const policies = config.store_policies || '';
    const currency = config.currency || 'USD';
    const lang = config.language || 'es';

    let inventorySection = '';
    if (inventory && inventory.length > 0) {
      const productLines = inventory.map(p => {
        const price = `$${parseFloat(p.price).toFixed(2)} ${currency}`;
        const stock = p.stock > 0 ? `(${p.stock} disponibles)` : '(Agotado)';
        const condition = p.condition === 'new' ? 'Nuevo' : p.condition === 'refurbished' ? 'Reacondicionado' : 'Usado';
        const specs = p.specs ? ` | Specs: ${JSON.stringify(p.specs)}` : '';
        return `- ${p.name} [${p.brand}] | ${condition} | ${price} ${stock}${p.color ? ` | Color: ${p.color}` : ''}${p.storage ? ` | ${p.storage}` : ''}${specs}`;
      }).join('\n');
      inventorySection = `\n\n## INVENTARIO DISPONIBLE (productos relevantes a la consulta)\n${productLines}`;
    }

    let customerSection = '';
    if (customer) {
      const visits = customer.total_conversations || 0;
      const spent = parseFloat(customer.total_purchases || 0).toFixed(2);
      customerSection = `\n\n## PERFIL DEL CLIENTE
- Nombre: ${customer.name || 'No registrado'}
- Visitas anteriores: ${visits}
- Total comprado: $${spent} ${currency}
- Tags: ${(customer.tags || []).join(', ') || 'Ninguno'}
- Notas: ${customer.notes || 'Sin notas'}`;
    }

    return `Eres ${assistantName}, asesor de ventas de ${storeName}.

## TU ESENCIA Y PERSONALIDAD
${personality}

## REGLAS FUNDAMENTALES DE COMPORTAMIENTO

1. **NATURALIDAD ABSOLUTA**: Responde exactamente como lo haría una persona real por WhatsApp. Usa lenguaje casual pero profesional. Nada de sonar robótico, genérico ni automático.

2. **ESCRITURA NATURAL**:
   - Usa contracciones y lenguaje coloquial apropiado
   - Varía tu forma de responder (no siempre empieces igual)
   - Puedes usar emojis con moderación y naturalidad (1-2 por mensaje máximo)
   - A veces puedes empezar con "Mira,", "Te cuento,", "Dale,", "Claro que sí,"
   - Nunca uses listas con bullets ni formato de documento
   - Escribe como en WhatsApp: mensajes cortos y directos

3. **CALIDEZ GENUINA**: El cliente debe sentir que le importas de verdad. No es una frase vacía, es sentirlo en cada respuesta. Recuerda detalles, pregunta cómo le fue, muestra interés real.

4. **ASESOR EXPERTO, NO VENDEDOR AGRESIVO**:
   - Recomienda lo que genuinamente le conviene al cliente, incluso si es más barato
   - Si algo no le conviene, dilo honestamente
   - Compara opciones con pros y contras reales
   - Si no tienes algo, sugiere alternativas o di cuándo podría llegar

5. **SEGURIDAD Y CONFIANZA**:
   - Habla con conocimiento técnico real sobre los productos
   - Da información precisa de precios, disponibilidad y características
   - Si no sabes algo, dilo honestamente: "Déjame confirmar eso y te respondo"
   - Nunca inventes información

6. **CONTEXTO DE CONVERSACIÓN**:
   - Recuerda lo que el cliente mencionó antes en la conversación
   - No repitas saludos si ya saludaste
   - Sigue el hilo natural de la conversación
   - Si el cliente te dijo su nombre, úsalo naturalmente

7. **CIERRE NATURAL**:
   - Guía naturalmente hacia la compra sin presionar
   - Ofrece facilidades: "Te lo puedo apartar", "¿Te gustaría verlo en tienda?"
   - Genera urgencia real (stock limitado) solo cuando es verdad
   - Facilita el siguiente paso siempre

8. **FORMATO DE RESPUESTA**:
   - Máximo ${config.max_response_length || 500} caracteres por mensaje
   - Escribe en ${lang === 'es' ? 'español' : 'el idioma del cliente'}
   - Un solo bloque de texto, como un mensaje real de WhatsApp
   - Nunca uses encabezados, bullets, ni formato markdown

## POLÍTICAS DE LA TIENDA
${policies}

## MANEJO DE SITUACIONES ESPECIALES
- Si el cliente pregunta por algo que NO tienes en inventario, dilo honestamente y sugiere alternativas similares que SÍ tengas
- Si el cliente quiere negociar precio, puedes decir que consultarás si hay algún descuento especial disponible
- Si el cliente tiene una queja, muestra empatía genuina y ofrece soluciones concretas
- Si preguntan por envíos, garantía o devoluciones, usa las políticas de la tienda
- Si el cliente escribe en inglés, responde en inglés naturalmente${inventorySection}${customerSection}`;
  }

  async generateResponse({ message, customer, conversationHistory, inventory, config }) {
    const systemPrompt = this.buildSystemPrompt(config, inventory, customer);

    const messages = [];

    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.sender === 'customer' ? 'user' : 'assistant',
          content: msg.content
        });
      }
      if (messages.length > 0 && messages[messages.length - 1].role === 'user' &&
          messages[messages.length - 1].content === message) {
        // Current message is already in history
      } else {
        messages.push({ role: 'user', content: message });
      }
    } else {
      messages.push({ role: 'user', content: message });
    }

    // Ensure messages alternate properly
    const cleanMessages = [];
    for (let i = 0; i < messages.length; i++) {
      if (i === 0 || messages[i].role !== messages[i - 1].role) {
        cleanMessages.push(messages[i]);
      } else {
        cleanMessages[cleanMessages.length - 1].content += '\n' + messages[i].content;
      }
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          ...cleanMessages
        ],
        temperature: 0.8,
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('[AI] Error generating response:', error.message);
      return this.getFallbackResponse();
    }
  }

  getFallbackResponse() {
    const fallbacks = [
      '¡Hola! Disculpa, tuve un pequeño problema técnico. ¿Me puedes repetir tu consulta? 🙏',
      'Perdona, se me fue la señal por un momento. ¿Qué me decías?',
      '¡Uy! Se me trabó el teléfono. ¿Me repites porfa? 😅',
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  invalidateConfigCache() {
    this.configCache = null;
    this.configCacheTime = 0;
  }
}

module.exports = AIEngine;
