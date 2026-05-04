export interface Portfolio {
  id: string;
  belong_id: string;
  name: string;
  currency: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  portfolio_id: string;
  ticker: string;
  market: 'US' | 'SGX' | 'HK' | 'CN' | 'COMMODITY';
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  notes: string | null;
  created_at: string;
  asset_type: 'stock' | 'commodity'; // DB default 'stock'; required in create payload for commodity trades
  unit: string | null;
}

export interface Holding {
  ticker: string;
  market: string;
  currency: string;
  shares: number;
  avg_cost: number;
  current_price: number | null;
  value: number | null;
  value_usd?: number;
  cost: number;
  unrealized_pl: number | null;
  unrealized_pl_pct: number | null;
}

export interface Dividend {
  id: string;
  portfolio_id: string;
  ticker: string;
  shares_at_exdate: number;
  amount_per_share: number;
  total_amount: number;
  currency: string;
  tax_rate: number;
  tax_withheld: number;
  ex_date: string;
  pay_date: string | null;
  source: 'auto' | 'manual';
  created_at: string;
}

export interface PortfolioSnapshot {
  id: string;
  portfolio_id: string;
  snapshot_date: string;
  total_value: number;
  total_cost: number;
  unrealized_pl: number;
  realized_pl: number;
  currency: string;
  detail: SnapshotDetail[];
  created_at: string;
}

export interface SnapshotDetail {
  ticker: string;
  shares: number;
  price: number;
  value: number;
  cost: number;
  unrealized_pl: number;
}

export interface PortfolioStats {
  total_value: number;
  total_cost: number;
  unrealized_pl: number;
  realized_pl: number;
  dividend_ytd: number;
  dividend_mtd: number;
  mom_gain: number | null;
  mom_gain_pct: number | null;
  currency: string;
}
