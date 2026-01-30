"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenseStats = void 0;
const supabase_1 = require("../config/supabase");
const error_1 = require("../middleware/error");
const currency_conversion_1 = require("../utils/currency-conversion");
const family_context_1 = require("../utils/family-context");
/**
 * Get expense statistics for the FIRE dashboard
 * Optimized: Uses 2-3 parallel queries instead of many sequential ones
 */
const getExpenseStats = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const viewContext = await (0, family_context_1.getViewContext)(req);
        // Parse optional year/month query parameters
        // month is 1-12 (January = 1), defaults to current month
        const now = new Date();
        const queryYear = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();
        const queryMonth = req.query.month ? parseInt(req.query.month, 10) - 1 : now.getMonth(); // Convert 1-12 to 0-11
        // Calculate date ranges based on query parameters or current date
        // - Target month: for this month's expenses
        // - Previous 6 months (excluding target): for monthly average calculation
        const currentMonthStart = new Date(queryYear, queryMonth, 1);
        const previousMonthStart = new Date(queryYear, queryMonth - 1, 1);
        const currentMonthEnd = new Date(queryYear, queryMonth + 1, 0);
        // Go back 6 months for average calculation (excluding target month)
        const sixMonthsAgoStart = new Date(queryYear, queryMonth - 6, 1);
        const formatDate = (d) => d.toISOString().split('T')[0];
        // Get user preferences for currency conversion
        const userPrefs = await (0, currency_conversion_1.getUserPreferences)(userId);
        const preferredCurrency = userPrefs?.preferred_currency || 'USD';
        const shouldConvert = userPrefs?.convert_all_to_preferred || false;
        // Build flows query with family/personal context (using simple belong_id filter)
        const flowsQuery = (0, family_context_1.applyOwnershipFilter)(supabase_1.supabaseAdmin.from('flows').select(`
        type,
        amount,
        currency,
        date,
        flow_expense_category_id,
        flow_expense_category:flow_expense_categories(id, name, icon)
      `), viewContext)
            .in('type', ['expense', 'income'])
            .gte('date', formatDate(sixMonthsAgoStart))
            .lte('date', formatDate(currentMonthEnd));
        // Single query to get all flows for 6+ months (income + expense)
        // This is more efficient than multiple queries
        const [flowsResult, linkedLedgersResult] = await Promise.all([
            flowsQuery,
            (0, family_context_1.applyOwnershipFilter)(supabase_1.supabaseAdmin.from('fire_linked_ledgers').select('ledger_id'), viewContext),
        ]);
        if (flowsResult.error) {
            console.error('Error fetching flows:', flowsResult.error);
            throw new error_1.AppError('Failed to fetch expense stats', 500);
        }
        const flows = flowsResult.data || [];
        const currentMonthStartStr = formatDate(currentMonthStart);
        const previousMonthStartStr = formatDate(previousMonthStart);
        // Helper to get month key (YYYY-MM) from date string
        const getMonthKey = (dateStr) => dateStr.substring(0, 7);
        // Collect all unique currencies from flows for exchange rate lookup
        const flowCurrencies = new Set();
        flowCurrencies.add(preferredCurrency.toLowerCase());
        flows.forEach((flow) => {
            if (flow.currency) {
                flowCurrencies.add(flow.currency.toLowerCase());
            }
        });
        // Fetch exchange rates for all currencies used
        const rateMap = shouldConvert ? await (0, currency_conversion_1.getExchangeRates)(Array.from(flowCurrencies)) : new Map();
        // Helper to convert amount to preferred currency
        const toPreferred = (amount, fromCurrency) => {
            if (!shouldConvert)
                return amount;
            const result = (0, currency_conversion_1.convertAmount)(amount, fromCurrency, preferredCurrency, rateMap);
            return result ? result.converted : amount;
        };
        // Process flows in a single pass
        let manualTotalCurrent = 0;
        let manualTotalPrevious = 0;
        let incomeThisMonth = 0;
        let manualFlowCount = 0;
        const categoryTotals = new Map();
        // Track expenses by month for average calculation (excluding current month)
        const expensesByMonth = new Map();
        flows.forEach((flow) => {
            const rawAmount = Number(flow.amount);
            const flowCurrency = flow.currency || 'USD';
            const amount = toPreferred(rawAmount, flowCurrency);
            const isCurrentMonth = flow.date >= currentMonthStartStr;
            const isPreviousMonth = flow.date >= previousMonthStartStr && flow.date < currentMonthStartStr;
            if (flow.type === 'income') {
                if (isCurrentMonth)
                    incomeThisMonth += amount;
            }
            else if (flow.type === 'expense') {
                if (isCurrentMonth) {
                    manualTotalCurrent += amount;
                    manualFlowCount++;
                    // Aggregate by category
                    const catId = flow.flow_expense_category_id;
                    const catInfo = flow.flow_expense_category;
                    const existing = categoryTotals.get(catId);
                    if (existing) {
                        existing.amount += amount;
                    }
                    else {
                        categoryTotals.set(catId, {
                            amount,
                            name: catInfo?.name || 'Uncategorized',
                            icon: catInfo?.icon || '📦',
                        });
                    }
                }
                else {
                    // Track previous month total separately for trend
                    if (isPreviousMonth) {
                        manualTotalPrevious += amount;
                    }
                    // Track all historical months for average (excluding current)
                    const monthKey = getMonthKey(flow.date);
                    expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + amount);
                }
            }
        });
        // Fetch linked ledger expenses only if user has linked ledgers
        const linkedLedgerIds = (linkedLedgersResult.data || []).map((l) => l.ledger_id);
        let linkedLedgerTotalCurrent = 0;
        let linkedLedgerTotalPrevious = 0;
        let linkedLedgerExpenseCount = 0;
        if (linkedLedgerIds.length > 0) {
            // Single query for linked ledger expenses with currency code
            const { data: linkedExpenses, error: linkedError } = await supabase_1.supabaseAdmin
                .from('expenses')
                .select(`
          amount,
          date,
          currency_id,
          ledger_currencies!currency_id(code)
        `)
                .in('ledger_id', linkedLedgerIds)
                .gte('date', formatDate(sixMonthsAgoStart))
                .lte('date', formatDate(currentMonthEnd));
            if (linkedError) {
                console.error('Error fetching linked ledger expenses:', linkedError);
            }
            // Collect unique currency codes from linked expenses
            const ledgerCurrencies = new Set();
            ledgerCurrencies.add(preferredCurrency.toLowerCase());
            (linkedExpenses || []).forEach((exp) => {
                const currency = exp.ledger_currencies;
                if (currency?.code) {
                    ledgerCurrencies.add(currency.code.toLowerCase());
                }
            });
            // Fetch exchange rates for ledger currencies (merge with existing rateMap)
            const ledgerRateMap = shouldConvert
                ? await (0, currency_conversion_1.getExchangeRates)(Array.from(ledgerCurrencies))
                : new Map();
            // Merge ledger rates into main rateMap
            ledgerRateMap.forEach((rate, code) => {
                if (!rateMap.has(code)) {
                    rateMap.set(code, rate);
                }
            });
            (linkedExpenses || []).forEach((exp) => {
                const rawAmount = Number(exp.amount);
                const currency = exp.ledger_currencies;
                const expCurrency = currency?.code || 'USD';
                // Convert to preferred currency using the same helper
                const amount = toPreferred(rawAmount, expCurrency);
                const isCurrentMonth = exp.date >= currentMonthStartStr;
                const isPreviousMonth = exp.date >= previousMonthStartStr && exp.date < currentMonthStartStr;
                if (isCurrentMonth) {
                    linkedLedgerTotalCurrent += amount;
                    linkedLedgerExpenseCount++;
                }
                else {
                    // Track previous month separately for trend
                    if (isPreviousMonth) {
                        linkedLedgerTotalPrevious += amount;
                    }
                    // Track all historical months for average (excluding current)
                    const monthKey = getMonthKey(exp.date);
                    expensesByMonth.set(monthKey, (expensesByMonth.get(monthKey) || 0) + amount);
                }
            });
        }
        // Calculate totals
        const totalCurrent = manualTotalCurrent + linkedLedgerTotalCurrent;
        const totalPrevious = manualTotalPrevious + linkedLedgerTotalPrevious;
        // Build category breakdown
        const byCategory = [];
        categoryTotals.forEach((data, catId) => {
            byCategory.push({
                category_id: catId,
                category_name: data.name,
                category_icon: data.icon,
                amount: data.amount,
                percentage: totalCurrent > 0 ? (data.amount / totalCurrent) * 100 : 0,
            });
        });
        // Sort by amount descending
        byCategory.sort((a, b) => b.amount - a.amount);
        // Calculate trend
        const amountChange = totalCurrent - totalPrevious;
        const percentageChange = totalPrevious > 0 ? ((totalCurrent - totalPrevious) / totalPrevious) * 100 : 0;
        let direction = 'same';
        if (amountChange > 0.01)
            direction = 'up';
        else if (amountChange < -0.01)
            direction = 'down';
        // Calculate monthly average from historical data (excluding current month)
        // Uses up to 6 months of data for a stable average
        const daysInMonth = currentMonthEnd.getDate();
        const historicalMonths = Array.from(expensesByMonth.values());
        const monthlyAverage = historicalMonths.length > 0
            ? historicalMonths.reduce((sum, val) => sum + val, 0) / historicalMonths.length
            : 0;
        // Expense-to-income ratio
        const expenseToIncomeRatio = incomeThisMonth > 0 ? (totalCurrent / incomeThisMonth) * 100 : null;
        res.json({
            success: true,
            data: {
                current_month: {
                    total: Math.round(totalCurrent * 100) / 100,
                    by_category: byCategory.map((c) => ({
                        ...c,
                        amount: Math.round(c.amount * 100) / 100,
                        percentage: Math.round(c.percentage * 10) / 10,
                    })),
                    source_count: {
                        manual_flows: manualFlowCount,
                        linked_ledgers: linkedLedgerExpenseCount,
                    },
                    days_in_month: daysInMonth,
                    monthly_average: Math.round(monthlyAverage * 100) / 100,
                },
                previous_month: {
                    total: Math.round(totalPrevious * 100) / 100,
                },
                trend: {
                    amount_change: Math.round(amountChange * 100) / 100,
                    percentage_change: Math.round(percentageChange * 10) / 10,
                    direction,
                },
                income_this_month: Math.round(incomeThisMonth * 100) / 100,
                expense_to_income_ratio: expenseToIncomeRatio !== null ? Math.round(expenseToIncomeRatio * 10) / 10 : null,
            },
        });
    }
    catch (err) {
        if (err instanceof error_1.AppError)
            throw err;
        console.error('Error in getExpenseStats:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch expense stats' });
    }
};
exports.getExpenseStats = getExpenseStats;
//# sourceMappingURL=fire-expense-stats.controller.js.map