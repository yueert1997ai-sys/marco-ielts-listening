import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: node scripts/hash-password.mjs '<at least 12 characters>'");
  process.exit(1);
}

const iterations = 210000;
const salt = randomBytes(18);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const encode = (value) => value.toString("base64url");
console.log(`pbkdf2$${iterations}$${encode(salt)}$${encode(hash)}`);
