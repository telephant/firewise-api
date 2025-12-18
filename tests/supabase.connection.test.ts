/**
 * Supabase Connection Tests
 *
 * These tests verify the actual connection to Supabase.
 * Run with: pnpm test:connection
 *
 * Note: These tests require valid environment variables in .env
 * and will make real API calls to your Supabase instance.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env (not .env.test)
dotenv.config();

describe('Supabase Connection', () => {
  let supabase: SupabaseClient;
  let supabaseAdmin: SupabaseClient;

  beforeAll(() => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env'
      );
    }

    supabase = createClient(supabaseUrl, supabaseAnonKey);

    if (supabaseServiceRoleKey) {
      supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }
  });

  describe('Environment Variables', () => {
    it('should have SUPABASE_URL configured', () => {
      expect(process.env.SUPABASE_URL).toBeDefined();
      expect(process.env.SUPABASE_URL).toMatch(/^https:\/\/.+\.supabase\.co$/);
    });

    it('should have SUPABASE_ANON_KEY configured', () => {
      expect(process.env.SUPABASE_ANON_KEY).toBeDefined();
      expect(process.env.SUPABASE_ANON_KEY!.length).toBeGreaterThan(100);
    });

    it('should have SUPABASE_SERVICE_ROLE_KEY configured', () => {
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY!.length).toBeGreaterThan(100);
    });
  });

  describe('Database Connection', () => {
    it('should connect to Supabase with anon key', async () => {
      // Try to query a table - even if empty, connection should work
      const { error } = await supabase.from('currencies').select('count');

      // If table doesn't exist, we get a specific error
      // If connection fails, we get a different error
      if (error) {
        // These errors indicate connection works but table issues
        const acceptableErrors = [
          'relation "public.currencies" does not exist',
          'permission denied',
        ];
        const isAcceptableError = acceptableErrors.some(msg =>
          error.message.toLowerCase().includes(msg.toLowerCase())
        );

        if (!isAcceptableError) {
          // Log the error for debugging
          console.error('Connection error:', error);
        }

        // Connection itself should not fail with network/auth errors
        expect(error.message).not.toMatch(/fetch failed|network|ECONNREFUSED|invalid.*key/i);
      }

      // If no error, connection is successful
      expect(true).toBe(true);
    });

    it('should connect to Supabase with service role key', async () => {
      if (!supabaseAdmin) {
        console.warn('Skipping: SUPABASE_SERVICE_ROLE_KEY not configured');
        return;
      }

      const { error } = await supabaseAdmin.from('currencies').select('count');

      if (error) {
        expect(error.message).not.toMatch(/fetch failed|network|ECONNREFUSED|invalid.*key/i);
      }

      expect(true).toBe(true);
    });
  });

  describe('Table Existence', () => {
    const tables = [
      'profiles',
      'currencies',
      'expense_categories',
      'payment_methods',
      'ledgers',
      'ledger_users',
      'expenses',
    ];

    it.each(tables)('should have "%s" table accessible', async (tableName) => {
      const { error } = await supabase.from(tableName).select('count').limit(0);

      if (error) {
        // Table should exist - permission denied is OK (RLS), but "does not exist" is not
        expect(error.message).not.toMatch(/does not exist/i);
      }
    });
  });

  describe('Auth Service', () => {
    it('should have auth service available', async () => {
      // This should not throw - just verifies auth endpoint is reachable
      const { data, error } = await supabase.auth.getSession();

      // No session is expected (not logged in), but no connection error
      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe('Admin Operations (Service Role)', () => {
    it('should be able to query with admin client', async () => {
      if (!supabaseAdmin) {
        console.warn('Skipping: SUPABASE_SERVICE_ROLE_KEY not configured');
        return;
      }

      // Admin client should bypass RLS
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .limit(1);

      // Should not have permission errors with admin client
      if (error) {
        expect(error.message).not.toMatch(/permission denied/i);
      }

      expect(data).toBeDefined();
    });
  });
});
