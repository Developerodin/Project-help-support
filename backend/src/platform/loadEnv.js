import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// backend/.env — this service's own file. The frontend has its own next to it,
// loaded natively by Next from frontend/. One shared root .env is what let a
// backend PORT and NODE_ENV bleed into the Next build.
dotenv.config({ path: path.join(__dirname, '../../.env') });