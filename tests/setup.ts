try {
  process.loadEnvFile();
} catch {
  // no .env — rely on real environment variables (CI)
}
