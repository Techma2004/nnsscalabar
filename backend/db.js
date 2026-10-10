const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  // The routes use pool.query() with "?" placeholders. By default mysql2 expands
  // an *object* value into "`key` = 'value'" SQL, so a JSON body field sent as
  // {"id":1} instead of a string could rewrite a WHERE clause. With this set,
  // objects are stringified instead of expanded. Arrays (used for IN (?) and
  // bulk inserts) are unaffected.
  stringifyObjects: true,
  multipleStatements: false
});

module.exports = pool.promise();
