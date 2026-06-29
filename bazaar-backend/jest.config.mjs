/**
 * jest.config.mjs
 * ─────────────────────────────────────────────────────────────
 * Jest configuration for the BazarBoost integration test suite.
 * Compatible with "type": "module" (native ESM) projects.
 * ─────────────────────────────────────────────────────────────
 */

export default {
  // Use Node test environment (no browser DOM needed)
  testEnvironment: 'node',

  // Only pick up files inside /tests/ directory
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
  ],

  // Global timeout per test (30s covers socket handshake + DB round-trip)
  testTimeout: 30000,

  // Global teardown: fires ONCE after ALL test suites complete
  globalTeardown: '<rootDir>/tests/globalTeardown.js',

  // Force Jest to exit after all tests complete (kills hanging async handles)
  forceExit: true,

  // Verbose output for CI readability
  verbose: true,

  // No transform needed — project uses native ESM with --experimental-vm-modules
  transform: {},
};
