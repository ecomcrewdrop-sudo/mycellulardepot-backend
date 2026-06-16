-- MyCellularDepot WhatsApp AI Assistant - Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Customers ──
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    tags TEXT[] DEFAULT '{}',
    total_purchases DECIMAL(12,2) DEFAULT 0,
    total_conversations INTEGER DEFAULT 0,
    satisfaction_avg DECIMAL(3,2) DEFAULT 0,
    preferred_language VARCHAR(5) DEFAULT 'es',
    first_contact TIMESTAMPTZ DEFAULT NOW(),
    last_contact TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Conversations ──
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    intent VARCHAR(50),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    summary TEXT,
    sentiment VARCHAR(20) DEFAULT 'neutral',
    satisfaction_score INTEGER,
    tags TEXT[] DEFAULT '{}',
    products_discussed INTEGER[] DEFAULT '{}',
    escalated BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_conv_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_started ON conversations(started_at DESC);

-- ── Messages ──
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
    sender VARCHAR(15) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    wa_message_id VARCHAR(100),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_time ON messages(timestamp DESC);

-- ── Products / Inventory ──
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE,
    name VARCHAR(255) NOT NULL,
    brand VARCHAR(100),
    category VARCHAR(100),
    description TEXT,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    compare_price DECIMAL(12,2),
    cost DECIMAL(12,2),
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 2,
    condition VARCHAR(20) DEFAULT 'new',
    color VARCHAR(50),
    storage VARCHAR(50),
    specs JSONB DEFAULT '{}',
    image_url TEXT,
    active BOOLEAN DEFAULT TRUE,
    featured BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_prod_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_prod_active ON products(active);

-- ── Analytics Events ──
CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_time ON analytics_events(created_at DESC);

-- ── Assistant Configuration ──
CREATE TABLE IF NOT EXISTS assistant_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Response Templates ──
CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    active BOOLEAN DEFAULT TRUE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Admin Users ──
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Default Config Values ──
INSERT INTO assistant_config (key, value) VALUES
    ('store_name', '"MyCellularDepot"'),
    ('store_description', '"Tienda de tecnología y celulares con los mejores precios y atención personalizada"'),
    ('assistant_name', '"Alex"'),
    ('assistant_personality', '"Eres un asesor experto en tecnología y celulares. Eres cálido, amigable, profesional y genuinamente interesado en ayudar al cliente a encontrar la mejor solución. Hablas de manera natural, como un amigo que sabe mucho de tecnología."'),
    ('welcome_message', '"¡Hola! 👋 Bienvenido a MyCellularDepot. Soy Alex, tu asesor personal de tecnología. ¿En qué puedo ayudarte hoy?"'),
    ('business_hours', '{"start": "09:00", "end": "21:00", "timezone": "America/Bogota"}'),
    ('auto_reply_after_hours', '"¡Hola! Gracias por escribirnos. En este momento estamos fuera de horario, pero te responderemos a primera hora. ¡Tu mensaje es importante para nosotros!"'),
    ('response_style', '"natural"'),
    ('max_response_length', '500'),
    ('language', '"es"'),
    ('currency', '"USD"'),
    ('enable_product_recommendations', 'true'),
    ('enable_order_tracking', 'true'),
    ('escalation_keywords', '["hablar con humano", "persona real", "gerente", "queja", "reclamo"]'),
    ('store_policies', '"Garantía de 30 días en todos los productos. Envíos a todo el país. Aceptamos efectivo, tarjeta y transferencia."')
ON CONFLICT (key) DO NOTHING;
