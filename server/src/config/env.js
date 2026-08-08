import dotenv from 'dotenv';

const inherited = new Map(Object.entries(process.env));

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
dotenv.config();

for (const [key, value] of inherited) {
  process.env[key] = value;
}
