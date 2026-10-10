// Creates (or resets) the Commandant account.
//   INITIAL_COMMANDANT_CODE=CMD001 INITIAL_COMMANDANT_PASSWORD='<min 8 chars>' \
//   [INITIAL_COMMANDANT_NAME='...'] [INITIAL_COMMANDANT_EMAIL='...'] npm run seed:commandant
// The Commandant can then create admin accounts from Account Management.
require('dotenv').config();
const e = process.env;
e.INITIAL_ADMIN_ROLE = 'commandant';
e.INITIAL_ADMIN_CODE = e.INITIAL_COMMANDANT_CODE || '';
e.INITIAL_ADMIN_PASSWORD = e.INITIAL_COMMANDANT_PASSWORD || '';
e.INITIAL_ADMIN_NAME = e.INITIAL_COMMANDANT_NAME || 'The Commandant';
e.INITIAL_ADMIN_EMAIL = e.INITIAL_COMMANDANT_EMAIL || '';
if (!e.INITIAL_ADMIN_CODE || e.INITIAL_ADMIN_PASSWORD.length < 8) {
  console.error('Set INITIAL_COMMANDANT_CODE and INITIAL_COMMANDANT_PASSWORD (minimum 8 characters) first.');
  process.exit(1);
}
require('./seed-admin');
