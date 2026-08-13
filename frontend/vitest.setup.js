import '@testing-library/jest-dom/vitest';

// Every test runs as though the API base is configured; the ONE test that
// checks the missing case calls requireEnv directly.
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/v1';
