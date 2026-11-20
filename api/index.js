'use strict';

// Vercel serverless entry point. The same Express app remains the local server.
// Keep database and storage credentials in the Vercel project's server env only.
module.exports = require('../backend/server');
