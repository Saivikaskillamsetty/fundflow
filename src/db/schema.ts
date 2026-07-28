import {
  pgTable,
  serial,
  text,
  varchar,
  doublePrecision,
  bigint,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Asset Management Company funds. Stable entity — one row per fund.
// The reporting month lives on holdings/signals, NOT here, so a fund's
// positions can be compared across months by a single fund_id.
export const funds = pgTable(
  "funds",
  {
    id: serial("id").primaryKey(),
    amc: varchar("amc", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    category: varchar("category", { length: 128 }),
    sourceFile: text("source_file"), // most-recent source file seen
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("funds_name_uq").on(t.name)],
);

// Canonical stock identity. ISIN is the authoritative key when present.
export const stocks = pgTable(
  "stocks",
  {
    id: serial("id").primaryKey(),
    canonicalName: varchar("canonical_name", { length: 256 }).notNull(),
    nseSymbol: varchar("nse_symbol", { length: 32 }),
    bseSymbol: varchar("bse_symbol", { length: 32 }),
    isin: varchar("isin", { length: 12 }),
    sector: varchar("sector", { length: 128 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("stocks_isin_uq").on(t.isin),
    uniqueIndex("stocks_name_uq").on(t.canonicalName),
  ],
);

// A single fund's position in a stock for a given month.
export const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    fundId: integer("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    stockId: integer("stock_id")
      .notNull()
      .references(() => stocks.id, { onDelete: "cascade" }),
    holdingPct: doublePrecision("holding_pct").notNull(), // % to net assets
    sharesHeld: bigint("shares_held", { mode: "number" }),
    marketValue: doublePrecision("market_value"), // Rs. in lakhs
    reportMonth: varchar("report_month", { length: 7 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("holdings_fund_stock_month_uq").on(
      t.fundId,
      t.stockId,
      t.reportMonth,
    ),
    index("holdings_stock_month_idx").on(t.stockId, t.reportMonth),
  ],
);

// Per-fund per-stock month-over-month classification.
export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    fundId: integer("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    stockId: integer("stock_id")
      .notNull()
      .references(() => stocks.id, { onDelete: "cascade" }),
    reportMonth: varchar("report_month", { length: 7 }).notNull(),
    prevMonth: varchar("prev_month", { length: 7 }),
    signal: varchar("signal", { length: 4 }).notNull(), // BUY | SELL | HOLD
    deltaPct: doublePrecision("delta_pct").notNull(),
    deltaShares: bigint("delta_shares", { mode: "number" }),
    deltaValue: doublePrecision("delta_value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("signals_fund_stock_month_uq").on(
      t.fundId,
      t.stockId,
      t.reportMonth,
    ),
    index("signals_stock_month_idx").on(t.stockId, t.reportMonth),
  ],
);

// Upload tracking for async parse jobs.
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  storedPath: text("stored_path").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("queued"), // queued|parsing|done|error
  amcDetected: varchar("amc_detected", { length: 128 }),
  fundName: varchar("fund_name", { length: 256 }),
  reportMonth: varchar("report_month", { length: 7 }),
  holdingsCount: integer("holdings_count"),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Cached LLM insight per stock (latest month narrative).
export const insights = pgTable("insights", {
  id: serial("id").primaryKey(),
  stockId: integer("stock_id")
    .notNull()
    .references(() => stocks.id, { onDelete: "cascade" })
    .unique(),
  reportMonth: varchar("report_month", { length: 7 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Fund = typeof funds.$inferSelect;
export type Stock = typeof stocks.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
