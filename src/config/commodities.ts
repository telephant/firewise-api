export type CommodityUnit = 'troy_oz' | 'barrel' | 'gram' | 'kg' | 'oz' | 'pound' | 'unit';

export interface CommodityConfig {
  name: string;
  unit: CommodityUnit;
  currency: string;
}

export const COMMODITY_CONFIG: Record<string, CommodityConfig> = {
  'GC=F': { name: 'Gold',        unit: 'troy_oz', currency: 'USD' },
  'SI=F': { name: 'Silver',      unit: 'troy_oz', currency: 'USD' },
  'PL=F': { name: 'Platinum',    unit: 'troy_oz', currency: 'USD' },
  'CL=F': { name: 'Crude Oil',   unit: 'barrel',  currency: 'USD' },
};

export const COMMODITY_TICKERS = Object.keys(COMMODITY_CONFIG);

export const UNIT_LABELS: Record<CommodityUnit, string> = {
  troy_oz: 'troy oz',
  barrel:  'barrel',
  gram:    'g',
  kg:      'kg',
  oz:      'oz',
  pound:   'lb',
  unit:    'unit',
};
