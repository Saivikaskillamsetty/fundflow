// Curated "top funds" per AMC — we only ingest these flagship equity schemes,
// not every scheme an AMC discloses. Keeps the dataset focused on the funds
// that actually move markets and avoids debt/niche/junk noise.
//
// Matched against the parsed/derived fund name (case-insensitive substring).

// Never ingest these, even if they match a top-fund name (we want actively
// managed equity funds, not passive index/ETF/FoF products).
const EXCLUDE = /(\bIndex\b|\bETF\b|Nifty|Sensex|\bBSE\b|Fund of Fund|\bFoF\b|G-Sec|Gilt)/i;

export const TOP_FUNDS: { match: RegExp; test: RegExp }[] = [
  {
    // HDFC — largest equity schemes by AUM, plus liquid thematic/sectoral
    // schemes whose monthly files HDFC publishes alongside the flagships
    match: /HDFC/i,
    test: /(Balanced Advantage|Mid[\s-]?Cap|Flexi[\s-]?Cap|Large[\s-]?Cap|Large and Mid Cap|Small[\s-]?Cap|ELSS|Tax\s?saver|Focused|Multi[\s-]?Cap|Hybrid Equity|Infrastructure|Technology|MNC|Defence|Innovation|Business Cycle|Housing Opportunities|Transportation and Logistics|Capital Builder|Value Fund|Dividend Yield|Retirement.*Equity)/i,
  },
  {
    // Nippon India — flagship equity schemes (consolidated workbook, so
    // extra names cost no additional downloads)
    match: /Nippon|Reliance/i,
    test: /(Large Cap|Growth Mid Cap|Mid Cap|Small Cap|Multi Cap|Value Fund|Focused|ELSS|Flexi Cap|Vision|Power & Infra|Banking & Financial|Consumption|Pharma|Innovation|Quant|Dividend|Infrastructure|Growth Fund)/i,
  },
  {
    // Axis — flagship equity schemes
    match: /\bAxis\b/i,
    test: /(Bluechip|Midcap|Mid Cap|Small Cap|Flexi[\s-]?Cap|Long Term Equity|ELSS|Tax Saver|Focused|Growth Opportunities|Multicap|Multi Cap|Value Fund|Quant Fund)/i,
  },
  {
    // Tata — flagship equity schemes
    match: /\bTata\b/i,
    test: /(Small Cap|Mid Cap|Large (&|and) Mid|Flexi[\s-]?Cap|Multicap|Multi Cap|ELSS|Tax Saver|Large Cap|Focused|Equity P\/?E|Digital India|India Consumer|Business Cycle|Value)/i,
  },
  {
    // Franklin Templeton — flagship equity schemes
    match: /Franklin|Templeton/i,
    test: /(Flexi[\s-]?Cap|Prima|Smaller Companies|Bluechip|Focused|ELSS|Taxshield|Opportunities|Technology|Equity Advantage|Large (&|and) Mid)/i,
  },
  {
    // Motilal Oswal — flagship equity schemes
    match: /Motilal/i,
    test: /(Midcap|Mid Cap|Flexi[\s-]?Cap|Large (&|and) Mid|Small Cap|ELSS|Tax Saver|Focused|Multi Cap|Multicap|Large Cap)/i,
  },
  {
    // Edelweiss — flagship equity schemes
    match: /Edelweiss/i,
    test: /(Mid Cap|Small Cap|Large (&|and) Mid|Flexi[\s-]?Cap|Large Cap|ELSS|Tax Saver|Focused|Multi Cap|Multicap|Recently Listed IPO|Business Cycle)/i,
  },
  {
    // Quant — flagship equity schemes
    match: /\bQuant\b/i,
    test: /(Small Cap|Mid Cap|Flexi[\s-]?Cap|Active|ELSS|Tax|Large (&|and) Mid|Value|Infrastructure|Momentum|Large Cap|Multi Cap|Multicap|Focused|Business Cycle)/i,
  },
];

/** Is this fund one of the curated top funds for its AMC? */
export function isTopFund(amc: string, fundName: string): boolean {
  if (EXCLUDE.test(fundName)) return false;
  const rule = TOP_FUNDS.find((r) => r.match.test(amc));
  if (!rule) return true; // no curation rule for this AMC → keep everything
  return rule.test.test(fundName);
}

/** Filter a list of discovered filenames to the AMC's top funds. */
export function keepTopFundFile(amc: string, filename: string): boolean {
  return isTopFund(amc, filename);
}
