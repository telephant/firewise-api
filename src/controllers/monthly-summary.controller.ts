import { Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { getViewContext, applyOwnershipFilter } from '../utils/family-context';
import { getUserPreferences, getExchangeRates, convertAmount } from '../utils/currency-conversion';

/**
 * Monthly Summary Controller
 *
 * Returns monthly summary including:
 * - Income (active vs passive breakdown)
 * - Expenses (by category and linked ledger)
 * - Debt payments
 * - Net (income - expenses - debt payments)
 */

// Passive income categories
const PASSIVE_INCOME_CATEGORIES = ['interest', 'dividend', 'rental', 'passive_other'];

// Active income categories
const ACTIVE_INCOME_CATEGORIES = ['salary', 'bonus', 'freelance', 'gift', 'capital_gains', 'refund', 'other'];

interface CategoryBreakdown {
  category: string;
  amount: number;
  count: number;
}

interface LedgerBreakdown {
  ledger_id: string;
  ledger_name: string;
  amount: number;
  count: number;
}

interface MonthlySummaryStats {
  income: {
    total: number;
    active: {
      total: number;
      breakdown: CategoryBreakdown[];
    };
    passive: {
      total: number;
      breakdown: CategoryBreakdown[];
    };
  };
  expenses: {
    total: number;
    local: {
      total: number;
      byCategory: CategoryBreakdown[];
    };
    ledgers: {
      total: number;
      breakdown: LedgerBreakdown[];
    };
  };
  debtPayments: {
    total: number;
    count: number;
  };
  net: number;
  currency: string;
  year: number;
  month: number;
}

/**
 * GET /api/fire/monthly-summary
 *
 * Get monthly summary stats
 */
export const getMonthlySummary = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse<MonthlySummaryStats>>
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const viewContext = await getViewContext(req);

    // Get user preferences for currency
    const preferences = await getUserPreferences(userId);
    const preferredCurrency = preferences?.preferred_currency || 'USD';
    const shouldConvert = preferences?.convert_all_to_preferred || false;

    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) || now.getMonth() + 1; // 1-12

    // Date range for the month
    const monthStart = `${year}-${month.toString().padStart(2, '0')}-01`;
    const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];

    // Fetch all transactions for the month (excluding adjustments)
    let transactionsQuery = supabaseAdmin
      .from('transactions')
      .select('*')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .neq('category', 'adjustment');
    transactionsQuery = applyOwnershipFilter(transactionsQuery, viewContext);

    const { data: transactions, error: transactionsError } = await transactionsQuery;

    if (transactionsError) {
      console.error('Failed to fetch transactions:', transactionsError);
      res.status(500).json({ success: false, error: 'Failed to fetch monthly summary' });
      return;
    }

    // Fetch linked ledgers for expense breakdown
    let linkedLedgersQuery = supabaseAdmin
      .from('fire_linked_ledgers')
      .select('ledger_id, ledgers!inner(name)');
    linkedLedgersQuery = applyOwnershipFilter(linkedLedgersQuery, viewContext);

    const { data: linkedLedgers } = await linkedLedgersQuery;
    const ledgerMap = new Map<string, string>();
    const linkedLedgerIds: string[] = [];
    linkedLedgers?.forEach((ll: { ledger_id: string; ledgers: { name: string } | { name: string }[] }) => {
      const ledger = Array.isArray(ll.ledgers) ? ll.ledgers[0] : ll.ledgers;
      if (ledger?.name) {
        ledgerMap.set(ll.ledger_id, ledger.name);
        linkedLedgerIds.push(ll.ledger_id);
      }
    });

    // Fetch expenses from linked ledgers (from expenses table, not transactions)
    let linkedLedgerExpenses: { ledger_id: string; amount: number; currency_id: string; ledger_currencies: { code: string } | { code: string }[] | null }[] = [];
    if (linkedLedgerIds.length > 0) {
      const { data: expenses } = await supabaseAdmin
        .from('expenses')
        .select(`
          ledger_id,
          amount,
          currency_id,
          ledger_currencies!currency_id(code)
        `)
        .in('ledger_id', linkedLedgerIds)
        .gte('date', monthStart)
        .lte('date', monthEnd);

      linkedLedgerExpenses = (expenses || []) as typeof linkedLedgerExpenses;
    }

    // Get exchange rates if needed
    const currencies = new Set<string>([preferredCurrency.toLowerCase()]);
    transactions?.forEach((t) => {
      currencies.add((t.currency || 'USD').toLowerCase());
    });
    // Also include currencies from linked ledger expenses
    linkedLedgerExpenses.forEach((exp) => {
      const lc = exp.ledger_currencies;
      const currency = Array.isArray(lc) ? lc[0] : lc;
      if (currency?.code) {
        currencies.add(currency.code.toLowerCase());
      }
    });
    const rateMap = shouldConvert ? await getExchangeRates(Array.from(currencies)) : new Map<string, number>();

    // Helper to convert amount
    const convertToPreferred = (amount: number, fromCurrency: string): number => {
      if (!shouldConvert || fromCurrency.toLowerCase() === preferredCurrency.toLowerCase()) {
        return amount;
      }
      const result = convertAmount(amount, fromCurrency, preferredCurrency, rateMap);
      return result?.converted ?? amount;
    };

    // Initialize breakdowns
    const activeIncomeBreakdown = new Map<string, { amount: number; count: number }>();
    const passiveIncomeBreakdown = new Map<string, { amount: number; count: number }>();
    const localExpenseCategoryBreakdown = new Map<string, { amount: number; count: number }>();
    const expenseLedgerBreakdown = new Map<string, { amount: number; count: number; name: string }>();

    let activeIncomeTotal = 0;
    let passiveIncomeTotal = 0;
    let localExpenseTotal = 0;
    let ledgerExpenseTotal = 0;
    let debtPaymentTotal = 0;
    let debtPaymentCount = 0;

    // Process transactions
    (transactions || []).forEach((t) => {
      const amount = convertToPreferred(t.amount, t.currency || 'USD');
      const category = t.category || 'other';

      if (t.type === 'income') {
        if (PASSIVE_INCOME_CATEGORIES.includes(category)) {
          // Passive income
          passiveIncomeTotal += amount;
          const existing = passiveIncomeBreakdown.get(category) || { amount: 0, count: 0 };
          passiveIncomeBreakdown.set(category, {
            amount: existing.amount + amount,
            count: existing.count + 1,
          });
        } else if (ACTIVE_INCOME_CATEGORIES.includes(category)) {
          // Active income
          activeIncomeTotal += amount;
          const existing = activeIncomeBreakdown.get(category) || { amount: 0, count: 0 };
          activeIncomeBreakdown.set(category, {
            amount: existing.amount + amount,
            count: existing.count + 1,
          });
        }
        // Skip other categories (adjustment, deposit, transfer, etc.)
      } else if (t.type === 'debt_payment') {
        // Debt payment transactions
        debtPaymentTotal += amount;
        debtPaymentCount += 1;
      } else if (t.type === 'expense') {
        // Local expense (from transactions table - these are FIRE-recorded expenses)
        localExpenseTotal += amount;
        const existing = localExpenseCategoryBreakdown.get(category) || { amount: 0, count: 0 };
        localExpenseCategoryBreakdown.set(category, {
          amount: existing.amount + amount,
          count: existing.count + 1,
        });
      }
    });

    // Process linked ledger expenses (from expenses table)
    linkedLedgerExpenses.forEach((exp) => {
      const lc = exp.ledger_currencies;
      const currency = Array.isArray(lc) ? lc[0] : lc;
      const expCurrency = currency?.code || 'USD';
      const amount = convertToPreferred(exp.amount, expCurrency);
      const ledgerId = exp.ledger_id;
      const ledgerName = ledgerMap.get(ledgerId) || 'Unknown Ledger';

      ledgerExpenseTotal += amount;
      const existingLedger = expenseLedgerBreakdown.get(ledgerId) || { amount: 0, count: 0, name: ledgerName };
      expenseLedgerBreakdown.set(ledgerId, {
        amount: existingLedger.amount + amount,
        count: existingLedger.count + 1,
        name: ledgerName,
      });
    });

    // Format breakdowns
    const formatCategoryBreakdown = (breakdown: Map<string, { amount: number; count: number }>): CategoryBreakdown[] => {
      return Array.from(breakdown.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount,
          count: data.count,
        }))
        .filter((item) => item.amount > 0)
        .sort((a, b) => b.amount - a.amount);
    };

    const formatLedgerBreakdown = (breakdown: Map<string, { amount: number; count: number; name: string }>): LedgerBreakdown[] => {
      return Array.from(breakdown.entries())
        .map(([ledger_id, data]) => ({
          ledger_id,
          ledger_name: data.name,
          amount: data.amount,
          count: data.count,
        }))
        .filter((item) => item.amount > 0)
        .sort((a, b) => b.amount - a.amount);
    };

    const totalIncome = activeIncomeTotal + passiveIncomeTotal;
    const totalExpenses = localExpenseTotal + ledgerExpenseTotal;
    const net = totalIncome - totalExpenses - debtPaymentTotal;

    res.json({
      success: true,
      data: {
        income: {
          total: totalIncome,
          active: {
            total: activeIncomeTotal,
            breakdown: formatCategoryBreakdown(activeIncomeBreakdown),
          },
          passive: {
            total: passiveIncomeTotal,
            breakdown: formatCategoryBreakdown(passiveIncomeBreakdown),
          },
        },
        expenses: {
          total: totalExpenses,
          local: {
            total: localExpenseTotal,
            byCategory: formatCategoryBreakdown(localExpenseCategoryBreakdown),
          },
          ledgers: {
            total: ledgerExpenseTotal,
            breakdown: formatLedgerBreakdown(expenseLedgerBreakdown),
          },
        },
        debtPayments: {
          total: debtPaymentTotal,
          count: debtPaymentCount,
        },
        net,
        currency: shouldConvert ? preferredCurrency : 'USD',
        year,
        month,
      },
    });
  } catch (err) {
    console.error('getMonthlySummary error:', err);
    res.status(500).json({ success: false, error: 'Failed to get monthly summary' });
  }
};
