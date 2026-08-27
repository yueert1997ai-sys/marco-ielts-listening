import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: node scripts/hash-password.mjs '<at least 12 characters>'");
  process.exit(1);
}

// Cloudflare Workers WebCrypto currently caps PBKDF2 at 100,000 iterations.
const iterations = 100000;
const salt = randomBytes(18);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const encode = (value) => value.toString("base64url");
console.log(`pbkdf2$${iterations}$${encode(salt)}$${encode(hash)}`);
