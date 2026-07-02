/**
 * Boot-time environment variable validation.
 * Fails fast with a descriptive error if any required variable is missing.
 * Must be called AFTER dotenv.config() and BEFORE any other initialization.
 */
function validateEnv() {
    const required = [
        'JWT_SECRET',
        'MONGODB_USER',
        'MONGODB_PASSWORD',
        'MONGODB_CLUSTER',
        'MONGODB_DB_NAME',
        'REDIS_URL',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'S3_BUCKET_NAME',
        'AWS_REGION',
    ];

    const missing = required.filter((key) => !process.env[key] || process.env[key].trim() === '');

    if (missing.length > 0) {
        console.error('\n╔══════════════════════════════════════════════════════════╗');
        console.error('║  FATAL: Missing required environment variables           ║');
        console.error('╠══════════════════════════════════════════════════════════╣');
        missing.forEach((key) => {
            console.error(`║  ✗ ${key.padEnd(52)}║`);
        });
        console.error('╠══════════════════════════════════════════════════════════╣');
        console.error('║  Set these in your .env file or CI/CD secret manager.   ║');
        console.error('║  The server cannot start without them.                  ║');
        console.error('╚══════════════════════════════════════════════════════════╝\n');
        process.exit(1);
    }

    // Warn about weak JWT secrets (common dev mistake)
    if (process.env.JWT_SECRET.length < 32) {
        console.warn('⚠️  WARNING: JWT_SECRET is shorter than 32 characters. Use a strong, random secret in production.');
    }
}

module.exports = validateEnv;
