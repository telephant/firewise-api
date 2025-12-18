import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// Mock Supabase for testing
jest.mock('../src/config/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

beforeAll(() => {
  // Setup before all tests
});

afterAll(() => {
  // Cleanup after all tests
});
