# Fresh install on a new PC

On a new machine, **`database/schema.sql` is the only SQL file you run.** It is the complete, current database: all tables, the classes, arms, subjects and terms, and every upgrade that was ever made (files `002`–`006`). Do **not** run the other `.sql` files in `database/`. They exist only to upgrade older databases that already hold data.

## Steps

1. Install Node.js 20+, Git and MySQL 8 / MariaDB 10.6+.
2. Get the code:
   ```bash
   git clone https://github.com/Techma2004/nnsscalabar.git
   cd nnsscalabar
   ```
3. Load the database. This creates `nnss_calabar` and everything in it:
   ```bash
   mysql -u root -p < database/schema.sql
   ```
4. Create a database user for the app (change the password):
   ```sql
   CREATE USER 'nnss_user'@'localhost' IDENTIFIED BY 'your-strong-db-password';
   GRANT ALL PRIVILEGES ON nnss_calabar.* TO 'nnss_user'@'localhost';
   FLUSH PRIVILEGES;
   ```
5. Create the settings file and edit it:
   ```bash
   cp backend/.env.example backend/.env
   ```
   Set `DB_PASSWORD` (the password from step 4), `JWT_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), and `INITIAL_ADMIN_PASSWORD`.
6. Install and create the first login:
   ```bash
   cd backend
   npm install
   npm run seed:admin
   npm start
   ```
7. Open `http://localhost:5000/login.html` and sign in with `INITIAL_ADMIN_CODE` / `INITIAL_ADMIN_PASSWORD`.

`seed:admin` creates an `admin` account. To create a `commandant` instead, set `INITIAL_ADMIN_ROLE=commandant` in `backend/.env` before running it.

## What you do NOT need

- The other `.sql` files in `database/` (`002`–`006`): already inside `schema.sql`.
- `database/import-rosters.js`: optional, only to load the SS1 SIRI and JSS3 AYAM class lists.
- `seed-demo.js` and `test-seed.js`: demo and test data only.
- Python, uv and Tesseract: only for the AI Scanner. Manual Entry and Excel upload work without them.

Safe to re-run: `schema.sql` can be loaded again without errors, but do not re-load it over a live school database without a backup.
