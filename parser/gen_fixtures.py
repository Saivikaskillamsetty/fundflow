#!/usr/bin/env python3
"""Generate realistic SEBI-standard monthly-portfolio PDFs + ground-truth JSON.

Creates two consecutive months for several funds across AMCs so the app has
a populated dashboard and the parser has fixtures to test against. The PDF
layout mirrors the mandated equity-holdings table:

    Name of the Instrument | ISIN | Industry | Quantity | Market Value (Rs. in Lakhs) | % to Net Assets

Outputs into parser/fixtures/:
    <fund>_<month>.pdf        — rendered factsheet
    dataset.json              — ground-truth holdings for all funds/months (seed)
"""
import json
import os
import random

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                Spacer)
from reportlab.lib.styles import getSampleStyleSheet

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")

# Universe of stocks: (name, isin, sector)
UNIVERSE = [
    ("Reliance Industries Ltd", "INE002A01018", "Petroleum Products"),
    ("HDFC Bank Ltd", "INE040A01034", "Banks"),
    ("ICICI Bank Ltd", "INE090A01021", "Banks"),
    ("Infosys Ltd", "INE009A01021", "IT - Software"),
    ("Tata Consultancy Services Ltd", "INE467B01029", "IT - Software"),
    ("Larsen & Toubro Ltd", "INE018A01030", "Construction"),
    ("Axis Bank Ltd", "INE238A01034", "Banks"),
    ("State Bank of India", "INE062A01020", "Banks"),
    ("Bharti Airtel Ltd", "INE397D01024", "Telecom - Services"),
    ("ITC Ltd", "INE154A01025", "Diversified FMCG"),
    ("Kotak Mahindra Bank Ltd", "INE237A01028", "Banks"),
    ("Hindustan Unilever Ltd", "INE030A01027", "Diversified FMCG"),
    ("Bajaj Finance Ltd", "INE296A01024", "Finance"),
    ("Maruti Suzuki India Ltd", "INE585B01010", "Automobiles"),
    ("Sun Pharmaceutical Industries Ltd", "INE044A01036", "Pharmaceuticals"),
    ("Titan Company Ltd", "INE280A01028", "Consumer Durables"),
    ("Asian Paints Ltd", "INE021A01026", "Consumer Durables"),
    ("NTPC Ltd", "INE733E01010", "Power"),
    ("Tata Motors Ltd", "INE155A01022", "Automobiles"),
    ("UltraTech Cement Ltd", "INE481G01011", "Cement"),
]

# Funds: (amc, fund_name, category, num_holdings)
FUNDS = [
    ("SBI Mutual Fund", "SBI Bluechip Fund", "Large Cap", 16),
    ("HDFC Mutual Fund", "HDFC Flexi Cap Fund", "Flexi Cap", 18),
    ("ICICI Prudential Mutual Fund", "ICICI Prudential Bluechip Fund", "Large Cap", 15),
    ("Axis Mutual Fund", "Axis Growth Opportunities Fund", "Large & Mid Cap", 17),
    ("Nippon India Mutual Fund", "Nippon India Large Cap Fund", "Large Cap", 16),
    ("Kotak Mutual Fund", "Kotak Equity Opportunities Fund", "Large & Mid Cap", 15),
]

MONTHS = ["2026-04", "2026-05"]
MONTH_LABEL = {"2026-04": "April 30, 2026", "2026-05": "May 31, 2026"}

# Non-equity rows appended to every fund to test the skip-row filter.
NON_EQUITY = [
    ("Treasury Bill 91 Days", "IN002025X018", "Sovereign", 1200000, 1180.50, 2.10),
    ("TREPS / Reverse Repo", "", "Cash & Equivalents", 0, 950.20, 1.60),
    ("Net Receivables / (Payables)", "", "", 0, -120.00, -0.20),
]


def build_fund_month(rng, fund, prev_holdings, month):
    amc, name, category, n = fund
    picks = rng.sample(UNIVERSE, n)
    holdings = []
    prev_by_isin = {h["isin"]: h for h in (prev_holdings or [])}
    for stock_name, isin, sector in picks:
        if isin in prev_by_isin and month != MONTHS[0]:
            base = prev_by_isin[isin]["holding_pct"]
            # Shift weight: some buy, some sell, some hold.
            delta = rng.choice([
                rng.uniform(0.3, 1.5),    # buy
                -rng.uniform(0.3, 1.2),   # sell
                rng.uniform(-0.05, 0.05), # hold
            ])
            pct = max(0.4, round(base + delta, 2))
        else:
            pct = round(rng.uniform(1.0, 8.5), 2)
        shares = int(pct * rng.uniform(80000, 160000))
        mval = round(pct * rng.uniform(900, 1400), 2)
        holdings.append({
            "stock_name": stock_name,
            "isin": isin,
            "sector": sector,
            "holding_pct": pct,
            "market_value": mval,
            "shares_held": shares,
        })
    holdings.sort(key=lambda h: h["holding_pct"], reverse=True)
    return holdings


def render_pdf(fund, month, holdings, path):
    amc, name, category, _ = fund
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(path, pagesize=A4,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=14 * mm, rightMargin=14 * mm)
    elems = []
    elems.append(Paragraph(f"<b>{amc}</b>", styles["Title"]))
    elems.append(Paragraph(f"{name} ({category})", styles["Heading2"]))
    elems.append(Paragraph(
        f"Monthly Portfolio Statement as on {MONTH_LABEL[month]} "
        f"(Report Month {month})", styles["Normal"]))
    elems.append(Spacer(1, 6 * mm))

    header = ["Name of the Instrument", "ISIN", "Industry", "Quantity",
              "Market Value\n(Rs. in Lakhs)", "% to Net\nAssets"]
    data = [header]
    for h in holdings:
        data.append([
            h["stock_name"], h["isin"] or "", h["sector"] or "",
            f"{h['shares_held']:,}" if h["shares_held"] else "",
            f"{h['market_value']:,.2f}" if h["market_value"] is not None else "",
            f"{h['holding_pct']:.2f}",
        ])
    # Equity subtotal + non-equity rows.
    eq_total = sum(h["holding_pct"] for h in holdings)
    data.append(["Total Equity Holdings", "", "", "", "",
                 f"{eq_total:.2f}"])
    for nm, isin, sec, qty, mv, pct in NON_EQUITY:
        data.append([nm, isin, sec, f"{qty:,}" if qty else "",
                     f"{mv:,.2f}", f"{pct:.2f}"])
    data.append(["Grand Total", "", "", "", "", "100.00"])

    tbl = Table(data, repeatRows=1, colWidths=[58 * mm, 26 * mm, 30 * mm,
                                               22 * mm, 24 * mm, 18 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f3f4f6")]),
    ]))
    elems.append(tbl)
    doc.build(elems)


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(42)
    dataset = []
    for fund in FUNDS:
        prev = None
        for month in MONTHS:
            holdings = build_fund_month(rng, fund, prev, month)
            prev = holdings
            slug = fund[1].lower().replace(" ", "_").replace("&", "and")
            pdf_path = os.path.join(OUT, f"{slug}_{month}.pdf")
            render_pdf(fund, month, holdings, pdf_path)
            dataset.append({
                "amc": fund[0],
                "fund_name": fund[1],
                "category": fund[2],
                "report_month": month,
                "source_file": os.path.basename(pdf_path),
                "holdings": holdings,
            })
            print(f"wrote {pdf_path} ({len(holdings)} holdings)")
    with open(os.path.join(OUT, "dataset.json"), "w") as f:
        json.dump(dataset, f, indent=2)
    print(f"wrote {os.path.join(OUT, 'dataset.json')} "
          f"({len(dataset)} fund-months)")


if __name__ == "__main__":
    main()
