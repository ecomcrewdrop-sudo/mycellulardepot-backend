require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const db = require('./database');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  console.log('[DB] Initializing database...');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(schema);
  console.log('[DB] Schema created successfully');

  const email = process.env.ADMIN_EMAIL || 'admin@mycellulardepot.com';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = await bcrypt.hash(password, 12);

  await db.query(
    `INSERT INTO admin_users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    [email, hash, 'Admin', 'superadmin']
  );

  console.log(`[DB] Admin user created: ${email}`);
  console.log('[DB] Database initialization complete!');
  process.exit(0);
}

initDatabase().catch(err => {
  console.error('[DB] Init failed:', err);
  process.exit(1);
});
