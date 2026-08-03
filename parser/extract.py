#!/usr/bin/env python3
"""FundFlow holdings extractor.

Usage:
    python extract.py <file.pdf|file.xlsx>

Emits a single JSON object to stdout:
    {
      "amc": "...",
      "fund_name": "...",
      "report_month": "YYYY-MM",
      "holdings": [
        {"stock_name","isin","sector","holding_pct","market_value","shares_held"}
      ]
    }

Targets the SEBI-mandated monthly portfolio / fact-sheet equity table:
    Name of Instrument | ISIN | Industry | Quantity | Market Value | % to Net Assets

Design: a generic table reader + header-synonym map handles the standard
layout across AMCs; per-AMC hints only adjust detection + month parsing.
Scanned (image-only) PDFs are reported as an error — OCR is out of scope.
"""
import json
import re
import sys
from datetime import datetime

# ---- AMC detection ---------------------------------------------------------

AMC_PATTERNS = [
    ("SBI Mutual Fund", r"\bSBI\b|SBI Funds Management|SBI Mutual"),
    ("HDFC Mutual Fund", r"\bHDFC\b"),
    ("ICICI Prudential Mutual Fund", r"ICICI\s*Prudential|ICICI Pru"),
    ("Axis Mutual Fund", r"\bAxis\b"),
    ("Nippon India Mutual Fund", r"Nippon India|Reliance Mutual"),
    ("Kotak Mutual Fund", r"\bKotak\b"),
    ("Parag Parikh Mutual Fund", r"Parag Parikh|PPFAS"),
    ("Tata Mutual Fund", r"\bTata\b"),
    ("Franklin Templeton Mutual Fund", r"Franklin|Templeton"),
    ("Motilal Oswal Mutual Fund", r"Motilal"),
    ("Edelweiss Mutual Fund", r"Edelweiss"),
    ("Aditya Birla Sun Life Mutual Fund", r"Aditya Birla|Birla Sun Life|ABSL"),
    ("UTI Mutual Fund", r"\bUTI\b"),
    ("Mirae Asset Mutual Fund", r"Mirae"),
    ("DSP Mutual Fund", r"\bDSP\b"),
    ("Bandhan Mutual Fund", r"Bandhan"),
    ("Canara Robeco Mutual Fund", r"Canara Robeco"),
    # keep last: "quant" is a generic word (e.g. "Axis Quant Fund")
    ("Quant Mutual Fund", r"\bquant\b"),
]


def detect_amc(text: str, filename: str) -> str:
    # Filename first, as its own pass. Searching filename and body together
    # lets the body decide: nearly every equity scheme holds "HDFC Bank Ltd",
    # and because patterns are tried in list order, that lone holding matched
    # HDFC before the sheet's real AMC was ever reached — so an Axis or Kotak
    # portfolio came back as HDFC. An AMC names its own files, so when the
    # filename identifies one it is the trustworthy signal.
    # Separators must become spaces first: "_" is a word character, so \bKotak\b
    # does not match "kotak_equity_opportunities", and "nippon_india" does not
    # match "Nippon India".
    fname = re.sub(r"[^A-Za-z0-9]+", " ", filename)
    for amc, pat in AMC_PATTERNS:
        if re.search(pat, fname, re.IGNORECASE):
            return amc
    for amc, pat in AMC_PATTERNS:
        if re.search(pat, text[:4000], re.IGNORECASE):
            return amc
    return "Unknown AMC"


# ---- Header synonym mapping ------------------------------------------------

HEADER_MAP = {
    "stock_name": [
        "name of the instrument", "name of instrument", "instrument",
        "company name", "security name", "name of holding", "scrip name",
        "name",
    ],
    "isin": ["isin"],
    "sector": ["industry", "sector", "industry / rating", "industry/rating",
               "rating / industry", "industry classification"],
    "shares_held": ["quantity", "qty", "no. of shares", "no of shares",
                    "number of shares", "shares"],
    "market_value": ["market value", "market value (rs", "market/fair value",
                     "fair value", "market value (` in lakhs",
                     "market value (rs. in lakhs", "amount", "value"],
    "holding_pct": ["% to net assets", "% to nav", "% of net assets",
                    "% to net asset", "% of aum", "% to aum", "% holding",
                    "weightage", "% of total", "% net assets", "%age"],
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def map_headers(header_row):
    """Map a table header row -> {field: column_index}."""
    mapping = {}
    for idx, cell in enumerate(header_row):
        c = _norm(cell)
        if not c:
            continue
        for field, syns in HEADER_MAP.items():
            if field in mapping:
                continue
            if any(c == s or c.startswith(s) or s in c for s in syns):
                mapping[field] = idx
                break
    return mapping


def looks_like_header(row):
    joined = _norm(" ".join(c or "" for c in row))
    return ("isin" in joined or "name of" in joined) and (
        "% to" in joined or "net asset" in joined or "market value" in joined
        or "quantity" in joined
    )


# ---- Value coercion --------------------------------------------------------

ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
NUM_RE = re.compile(r"-?[\d,]+\.?\d*")

# Credit-rating tokens in the Industry/Rating column mark a DEBT instrument,
# not an equity — used to filter bonds/G-secs out of mixed scheme sheets.
RATING_RE = re.compile(
    r"\b(AAA|AA[+-]?|A1\+?|A2|A3|A4|BBB|SOV|sovereign|unrated|"
    r"CRISIL|ICRA|CARE|IND[\s-]?A|BWR|FITCH|brickwork)\b",
    re.IGNORECASE,
)

# Rows that are sub-totals / non-equity sections — skip them.
SKIP_ROW = re.compile(
    r"total|sub[\s-]*total|net (current )?asset|cash|treasury bill|tbills?|t-bills?|"
    r"treps|repo|reverse repo|margin|net receivable|grand total|"
    r"debt instrument|money market|government securit|corporate debt|"
    r"certificate of deposit|commercial paper|fixed deposit|"
    r"derivativ|futures|options|warrant",
    re.IGNORECASE,
)


def to_number(s):
    if s is None:
        return None
    m = NUM_RE.search(str(s).replace("%", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def clean_name(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    # Drop footnote markers / leading numbering like "1." or "(a)"
    s = re.sub(r"^\(?\d+[\.\)]\s*", "", s)
    s = re.sub(r"\$+$|\*+$|#+$|@+$", "", s).strip()
    return s


# ---- Month parsing ---------------------------------------------------------

MONTHS = {m.lower(): i for i, m in enumerate(
    ["", "January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"]) if m}
MONTHS.update({m[:3].lower(): i for m, i in list(MONTHS.items())})


def parse_month(text: str, filename: str):
    hay = f"{filename} {text[:3000]}"
    # YYYY-MM or MM-YYYY explicit
    m = re.search(r"(20\d{2})[-/](0[1-9]|1[0-2])", hay)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # "May 31, 2026" / "May 2026" (month before day)
    m = re.search(r"([A-Za-z]{3,9})[\s,]+(?:\d{1,2}[\s,]+)?(20\d{2})", hay)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
    # "31 May 2026" / "31st May, 2026" (day before month)
    m = re.search(r"(\d{1,2}[\s\-]*)?([A-Za-z]{3,9})[\s,\-]+(20\d{2})", hay)
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}"
    return None


# ---- PDF extraction --------------------------------------------------------

def extract_pdf(path):
    import pdfplumber

    all_text = []
    rows = []
    header_idx = None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            all_text.append(txt)
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or not any(row):
                        continue
                    if header_idx is None and looks_like_header(row):
                        header_idx = map_headers(row)
                        continue
                    # A header may repeat on later pages — keep first mapping.
                    if looks_like_header(row):
                        continue
                    rows.append(row)
    text = "\n".join(all_text)
    if header_idx is None:
        # No tabular holdings detected. Likely scanned/image PDF.
        if len(text.strip()) < 200:
            raise RuntimeError(
                "No extractable text or tables found — looks like a scanned "
                "PDF. OCR is not supported in this MVP.")
        raise RuntimeError("Could not locate a holdings table in the PDF.")
    return text, header_idx, rows


def rows_to_holdings(header_idx, rows):
    holdings = []
    name_i = header_idx.get("stock_name")
    for row in rows:
        cells = [(_norm(c) if False else (c or "")) for c in row]
        joined = " ".join(str(c) for c in cells)
        if SKIP_ROW.search(joined):
            continue
        # Skip debt instruments: a credit rating in the industry/rating column.
        if "sector" in header_idx and header_idx["sector"] < len(cells):
            if RATING_RE.search(str(cells[header_idx["sector"]])):
                continue
        name = clean_name(str(cells[name_i])) if name_i is not None and name_i < len(cells) else ""
        # ISIN can live in its own column or be embedded in the joined text.
        isin = None
        if "isin" in header_idx and header_idx["isin"] < len(cells):
            mm = ISIN_RE.search(str(cells[header_idx["isin"]]))
            isin = mm.group(1) if mm else None
        if not isin:
            mm = ISIN_RE.search(joined)
            isin = mm.group(1) if mm else None

        pct = to_number(cells[header_idx["holding_pct"]]) if "holding_pct" in header_idx and header_idx["holding_pct"] < len(cells) else None
        if not name or len(name) < 2:
            continue
        # Drop impossible weights (misparsed dates/totals like 2026%).
        if pct is not None and not (0 <= pct <= 100):
            continue
        # Require either a weight or an ISIN to count as a holding row.
        if pct is None and not isin:
            continue
        # A valid equity holding needs a real ISIN (INE/INF...). This drops
        # section labels, sub-totals, and stray text rows that slip through.
        if not isin:
            continue
        holdings.append({
            "stock_name": name,
            "isin": isin,
            "sector": (str(cells[header_idx["sector"]]).strip()
                       if "sector" in header_idx and header_idx["sector"] < len(cells) else None) or None,
            "holding_pct": pct,
            "market_value": to_number(cells[header_idx["market_value"]]) if "market_value" in header_idx and header_idx["market_value"] < len(cells) else None,
            "shares_held": (int(to_number(cells[header_idx["shares_held"]]))
                            if "shares_held" in header_idx and header_idx["shares_held"] < len(cells)
                            and to_number(cells[header_idx["shares_held"]]) is not None else None),
        })
    return holdings


# ---- XLSX extraction -------------------------------------------------------

def extract_xlsx(path):
    import pandas as pd

    xls = pd.ExcelFile(path)
    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet, header=None, dtype=str)
        raw = raw.fillna("")
        header_row_idx = None
        for i in range(min(len(raw), 40)):
            if looks_like_header(list(raw.iloc[i])):
                header_row_idx = i
                break
        if header_row_idx is None:
            continue
        header_idx = map_headers(list(raw.iloc[header_row_idx]))
        body = [list(raw.iloc[i]) for i in range(header_row_idx + 1, len(raw))]
        text = "\n".join(" ".join(map(str, r)) for r in raw.values[:30])
        return text, header_idx, body
    raise RuntimeError("Could not locate a holdings table in the spreadsheet.")


# ---- Multi-scheme consolidated workbook (real AMC monthly portfolios) -------
# A real AMC file is one workbook with ~40 sheets: an Index plus one sheet per
# scheme. Each scheme sheet has the scheme name near the top, a holdings header,
# then equity (+ often debt/cash) rows. We parse every sheet, keep only those
# with real equity holdings, and emit one fund per sheet.

SCHEME_NAME_RE = re.compile(r"([A-Z0-9][\w&.\-' ]*?(?:Fund|Scheme|Plan))", re.IGNORECASE)


def scheme_name_from_rows(rows_above):
    """Find the scheme name in the rows above the holdings header."""
    best = None
    for row in rows_above:
        for cell in row:
            s = re.sub(r"\s+", " ", str(cell or "")).strip()
            if not s:
                continue
            # "PORTFOLIO STATEMENT OF <SCHEME> AS ON ..." (e.g. Edelweiss) —
            # the statement banner itself carries the scheme name.
            ps = re.search(
                r"portfolio statement of (.+?)(?:\s+as\s+on\b|$)", s, re.IGNORECASE
            )
            if ps:
                s = ps.group(1).strip()
            elif "portfolio statement" in s.lower():
                continue
            # Drop a leading internal code token like "RLMF009 " (must contain
            # digits, so real words like "NIPPON" are not mistaken for a code).
            s = re.sub(r"^[A-Z]{2,6}\d{1,5}[A-Z]?\s+", "", s)
            # Cut any trailing scheme-description in parentheses.
            s = re.split(r"\s*\(", s)[0].strip()
            s = re.sub(r"\bindex\b$", "", s, flags=re.IGNORECASE).strip()
            # The AMC's own title ("quant Mutual Fund") is not a scheme name.
            if re.search(r"mutual fund$", s, re.IGNORECASE):
                continue
            if re.search(r"\b(Fund|Scheme|Plan)\b", s, re.IGNORECASE) and 5 < len(s) < 80:
                if best is None or len(s) < len(best):
                    best = s
    return best


def index_sheet_map(xls):
    """code -> scheme name from an Index/INDEX sheet, when the workbook names
    its scheme sheets with internal codes (Motilal YO07, Edelweiss EEELSS)."""
    import pandas as pd

    by_lower = {s.strip().lower(): s for s in xls.sheet_names}
    idx = next((by_lower[k] for k in ("index", "content") if k in by_lower), None)
    if not idx:
        return {}
    try:
        raw = pd.read_excel(xls, sheet_name=idx, header=None, dtype=str).fillna("")
    except Exception:
        return {}
    sheetset = {s.strip().upper() for s in xls.sheet_names}
    out = {}
    for i in range(len(raw)):
        cells = [re.sub(r"\s+", " ", str(c)).strip() for c in raw.iloc[i]]
        code = next(
            (c for c in cells if c.upper() in sheetset and 2 <= len(c) <= 10), None
        )
        name = next(
            (
                c
                for c in cells
                if re.search(r"\b(Fund|Scheme|Plan)\b", c, re.IGNORECASE)
                and len(c) > 8
                and not re.search(r"mutual fund$", c, re.IGNORECASE)
            ),
            None,
        )
        if code and name and code.upper() != name.upper():
            out[code.upper()] = re.split(r"\s*\(", name)[0].strip()
    return out


def normalize_fractions(holdings):
    """Some AMCs store '% to NAV' as a fraction (0.0087 = 0.87%). If the max
    weight is tiny, scale the column up to percentage points."""
    pcts = [h["holding_pct"] for h in holdings if h["holding_pct"] is not None]
    if pcts := [p for p in pcts if p is not None]:
        if max(pcts) <= 1.5:  # clearly fractions, not percents
            for h in holdings:
                if h["holding_pct"] is not None:
                    h["holding_pct"] = round(h["holding_pct"] * 100, 4)
    return holdings


def extract_xlsx_multi(path, amc, default_month):
    import pandas as pd

    xls = pd.ExcelFile(path)
    imap = index_sheet_map(xls)
    funds = []
    for sheet in xls.sheet_names:
        if sheet.strip().lower() in ("index", "disclaimer", "notes", "content"):
            continue
        try:
            raw = pd.read_excel(xls, sheet_name=sheet, header=None, dtype=str).fillna("")
        except Exception:
            continue
        rows = [list(raw.iloc[i]) for i in range(len(raw))]
        header_row = None
        for i in range(min(len(rows), 25)):
            if looks_like_header(rows[i]):
                header_row = i
                break
        if header_row is None:
            continue
        header_idx = map_headers(rows[header_row])
        name = (
            imap.get(sheet.strip().upper())
            or scheme_name_from_rows(rows[:header_row])
            or f"{amc} {sheet}"
        )
        month_txt = " ".join(str(c) for r in rows[: header_row + 1] for c in r)
        month = parse_month(month_txt, path) or default_month
        holdings = normalize_fractions(
            rows_to_holdings(header_idx, rows[header_row + 1 :])
        )
        # Keep only predominantly-equity schemes (drops debt/liquid/bond funds,
        # and the small equity sleeve of debt-oriented hybrids).
        eq_weight = sum(h["holding_pct"] or 0 for h in holdings)
        if len(holdings) >= 5 and eq_weight >= 40:
            funds.append(
                {"fund_name": name, "report_month": month, "holdings": holdings}
            )
    return funds


def is_multi_sheet(path):
    if not path.lower().endswith((".xlsx", ".xls")):
        return False
    try:
        import pandas as pd

        return len(pd.ExcelFile(path).sheet_names) > 3
    except Exception:
        return False


# ---- Fund name -------------------------------------------------------------

def guess_fund_name(text, filename):
    # Prefer an explicit "<Something> Fund" line near the top.
    for line in text.splitlines()[:40]:
        line = line.strip()
        if re.search(r"\bFund\b", line) and 5 < len(line) < 90 \
                and not re.search(r"mutual fund$", line, re.IGNORECASE):
            return re.sub(r"\s+", " ", line)
    base = re.sub(r"[_\-]+", " ", filename.rsplit("/", 1)[-1])
    return re.sub(r"\.(pdf|xlsx?)$", "", base, flags=re.IGNORECASE).strip()


def parse_file(path, fund_name_hint=None, amc_hint=None):
    """Parse one workbook/factsheet into the JSON-shaped dict callers expect.

    Returns either {"amc", "funds": [...]} for a consolidated multi-scheme
    workbook, or {"amc", "fund_name", "report_month", "holdings"} for a single
    scheme. Raises on failure; callers decide how to report it.

    `amc_hint` beats text sniffing, which can trip on holdings like "HDFC Bank"
    inside another AMC's sheet. `fund_name_hint` (e.g. from a clean per-scheme
    filename) beats scraping the sheet header.
    """
    # Consolidated multi-scheme workbook (real AMC monthly portfolio).
    if is_multi_sheet(path):
        # Read a little text for AMC detection.
        import pandas as pd

        first = pd.ExcelFile(path).sheet_names[0]
        head = pd.read_excel(path, sheet_name=first, header=None, nrows=15, dtype=str).fillna("")
        text = " ".join(str(x) for x in head.values.flatten())
        amc = amc_hint or detect_amc(text, path)
        default_month = parse_month(text, path) or datetime.now().strftime("%Y-%m")
        funds = extract_xlsx_multi(path, amc, default_month)
        if not funds:
            raise RuntimeError("No equity schemes found in workbook.")
        return {"amc": amc, "funds": funds}

    if path.lower().endswith((".xlsx", ".xls")):
        text, header_idx, rows = extract_xlsx(path)
    else:
        text, header_idx, rows = extract_pdf(path)
    holdings = rows_to_holdings(header_idx, rows)
    if not holdings:
        raise RuntimeError("Table found but no equity holdings parsed.")
    return {
        "amc": amc_hint or detect_amc(text, path),
        "fund_name": fund_name_hint or guess_fund_name(text, path),
        "report_month": parse_month(text, path) or datetime.now().strftime("%Y-%m"),
        "holdings": holdings,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: extract.py <file>"}))
        sys.exit(2)
    path = sys.argv[1]
    hint = sys.argv[2].strip() if len(sys.argv) > 2 and sys.argv[2].strip() else None
    amc_hint = sys.argv[3].strip() if len(sys.argv) > 3 and sys.argv[3].strip() else None
    try:
        print(json.dumps(parse_file(path, hint, amc_hint), ensure_ascii=False))
    except Exception as e:  # noqa: BLE001 - surface a clean error to the caller
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
