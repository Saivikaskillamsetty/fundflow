// Client-safe shapes mirroring the API responses (no server imports).

export interface StockAgg {
  stockId: number;
  name: string;
  sector: string | null;
  isin: string | null;
  fundsBuying: number;
  fundsSelling: number;
  fundsHolding: number;
  netDeltaPct: number;
  totalWeight: number;
  conviction: number;
}

export interface Dashboard {
  month: string | null;
  months: string[];
  cards: {
    fundsAnalyzed: number;
    stocksFound: number;
    strongBuys: number;
    strongSells: number;
  };
  topBought: StockAgg[];
  topSold: StockAgg[];
  sectorDeltas: { sector: string; netDeltaPct: number }[];
  heatmap: {
    funds: string[];
    stocks: string[];
    cells: { fund: string; stock: string; signal: string; deltaPct: number }[];
  };
}

export interface Rankings {
  month: string | null;
  months: string[];
  buying: StockAgg[];
  selling: StockAgg[];
}

export interface StockDetail {
  stock: { id: number; name: string; sector: string | null; isin: string | null };
  month: string | null;
  agg: StockAgg | null;
  rows: {
    fund: string;
    amc: string;
    prevPct: number | null;
    currPct: number | null;
    signal: string | null;
    deltaPct: number | null;
  }[];
  insight: string | null;
}

export interface UploadRow {
  id: number;
  filename: string;
  status: string;
  amcDetected: string | null;
  fundName: string | null;
  reportMonth: string | null;
  holdingsCount: number | null;
  errorMsg: string | null;
}
