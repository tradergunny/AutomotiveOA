/**
 * Side-effect module: load .env before anything reads DATABASE_URL.
 * Node does not auto-load it, and ES module imports evaluate in order — so
 * importing this FIRST in a script does what prisma.config.ts and
 * tests/setup.ts do for their own entry points.
 */
try {
  process.loadEnvFile();
} catch {
  // no .env — rely on real environment variables
}
