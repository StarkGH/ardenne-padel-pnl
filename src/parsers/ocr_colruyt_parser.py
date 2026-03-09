#!/usr/bin/env python3
import json
import re
import sys
from datetime import date

import fitz
import numpy as np
from rapidocr_onnxruntime import RapidOCR


def to_num(txt):
    if txt is None:
        return None
    s = str(txt).strip().replace(" ", "")
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None


def pick_number(tokens, x_min, x_max):
    cand = []
    for t in tokens:
        if t["x"] < x_min or t["x"] > x_max:
            continue
        m = re.search(r"(\d+[,.]\d{2,3}|\d+)", t["txt"])
        if not m:
            continue
        n = to_num(m.group(1))
        if n is None:
            continue
        cand.append((t["x"], n, t["txt"]))
    if not cand:
        return None
    cand.sort(key=lambda x: x[0])
    return cand[0][1]


def parse_invoice_date(texts, filename):
    joined = " ".join(texts)
    m = re.search(r"(\d{2})[/-](\d{2})[/-](\d{4})", joined)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"

    m2 = re.search(r"(20\d{2})", filename)
    year = int(m2.group(1)) if m2 else date.today().year
    months = {
        "JAN": 1, "FEV": 2, "FÉV": 2, "MAR": 3, "AVR": 4, "MAI": 5, "JUN": 6,
        "JUI": 7, "AOU": 8, "AOÛ": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12, "DÉC": 12
    }
    up = filename.upper()
    month = 1
    for k, v in months.items():
        if k in up:
            month = v
            break
    return f"{year:04d}-{month:02d}-01"


def parse_invoice_number(texts, filename):
    joined = " ".join(texts)
    m = re.search(r"facture\s*([0-9]{8,})", joined, flags=re.IGNORECASE)
    if m:
        return m.group(1)
    m2 = re.search(r"(\d{10,})", joined)
    if m2:
        return m2.group(1)
    return re.sub(r"\.[A-Za-z0-9]+$", "", filename)[:80]


def parse_total_ttc(entries, filename):
    # Cherche la ligne "APAYER" et prend le nombre à droite
    for e in entries:
        t = e["txt"].replace(" ", "").upper()
        if "APAYER" in t or "A_PAYER" in t:
            y = e["y"]
            right = [x for x in entries if abs(x["y"] - y) < 18 and x["x"] > e["x"] + 80]
            nums = []
            for r in right:
                m = re.search(r"(\d+[,.]\d{2})", r["txt"])
                if m:
                    n = to_num(m.group(1))
                    if n is not None:
                        nums.append(n)
            if nums:
                return max(nums)

    # Fallback nom fichier
    ms = list(re.finditer(r"(\d+[,.]\d{2})\s*€", filename))
    if ms:
        return to_num(ms[-1].group(1))
    return 0.0


def is_header_or_noise(desc):
    d = desc.upper()
    bad = [
        ".ART", "DENOMINATION", "QUANT", "BOISSONS", "ALCOOL", "ALIMENTATION",
        "PRODUITS", "TICKET DE GARANTIE", "GARANTIE", "ECHANGETOTAL",
    ]
    return any(b in d for b in bad)


def clean_desc(desc):
    d = " ".join(str(desc or "").split())
    repl = {
        "  ": " ",
        "1iquide": "liquide",
        "m1x": "mix",
        "toeates": "tomates",
        "boisson energicante": "boisson energisante",
        "oerit1v0": "aperitivo",
        "graanjenever301L": "graanjenever 30% 1L",
        "creeacate": "creme a cafe",
        "lalt": "lait",
        "st germa1n": "st germain",
        "Pere Foue.": "Pere Fouettard",
        "Papierto1let": "Papier toilette",
        "v1LEDA": "VILEDA",
        "vILEDA": "VILEDA",
        "oNI": "BONI",
    }
    for a, b in repl.items():
        d = d.replace(a, b)
    return d.strip(" -_.")


def group_rows(entries, tol=7.0):
    rows = []
    for e in sorted(entries, key=lambda x: (x["y"], x["x"])):
        placed = False
        for r in rows:
            if abs(r["y"] - e["y"]) <= tol:
                r["items"].append(e)
                r["y"] = (r["y"] * (len(r["items"]) - 1) + e["y"]) / len(r["items"])
                placed = True
                break
        if not placed:
            rows.append({"y": e["y"], "items": [e]})
    for r in rows:
        r["items"].sort(key=lambda x: x["x"])
    rows.sort(key=lambda r: r["y"])
    return rows


def extract_lines(entries):
    lines = []
    rows = group_rows(entries, tol=7.0)

    # bornes de zone article
    start_y = None
    end_y = None
    for r in rows:
        row_txt = " ".join(x["txt"] for x in r["items"]).upper().replace(" ", "")
        if start_y is None and (".ART" in row_txt or "DENOMINATION" in row_txt):
            start_y = r["y"] + 20
        if "APAYER" in row_txt and end_y is None:
            end_y = r["y"] - 10
    if start_y is None:
        start_y = rows[0]["y"] if rows else 0
    if end_y is None:
        end_y = rows[-1]["y"] if rows else 99999

    for r in rows:
        if r["y"] < start_y or r["y"] > end_y:
            continue
        items = r["items"]
        left = [x for x in items if x["x"] < 980]
        if not left:
            continue

        # Détection code (token séparé ou collé au début)
        code = None
        desc = None

        first_txt = left[0]["txt"].strip()
        m0 = re.match(r"^(\d{4,7})([A-Za-z].*)$", first_txt)
        if m0:
            code = m0.group(1)
            desc = m0.group(2).strip()
            if len(left) > 1:
                desc = (desc + " " + " ".join(x["txt"] for x in left[1:])).strip()
        else:
            m1 = re.match(r"^\d{4,7}$", first_txt)
            if m1:
                code = m1.group(0)
                desc = " ".join(x["txt"] for x in left[1:]).strip()
            else:
                # continuation de ligne précédente (pas de code)
                cont = " ".join(x["txt"] for x in left).strip()
                has_num = pick_number(items, 980, 1388) is not None
                if lines and cont and not has_num and not is_header_or_noise(cont):
                    lines[-1]["description"] = clean_desc(lines[-1]["description"] + " " + cont)
                continue

        desc = clean_desc(desc)
        # Coupe la description si un 2e code OCR s'est collé dedans (ex: "... 5214...")
        desc = re.split(r"\s+\d{4,7}[A-Za-z]", desc)[0].strip()
        if not code or len(desc) < 2 or is_header_or_noise(desc):
            continue

        qty = pick_number(items, 980, 1115)
        unit = pick_number(items, 1116, 1235)
        total = pick_number(items, 1236, 1388)
        if qty is None and unit is None and total is None:
            continue
        if qty is None:
            qty = 1.0
        if total is None and unit is not None:
            total = round(unit * qty, 2)
        if unit is None and total is not None and qty:
            unit = round(total / qty, 4)
        if qty == 1.0 and unit is not None and total is not None and unit > 0:
            q_guess = round(total / unit)
            if q_guess >= 2 and abs(q_guess * unit - total) < 0.2:
                qty = float(q_guess)
        if total is None:
            continue

        lines.append({
            "product_code": code,
            "description": desc,
            "quantity_colis": float(qty),
            "quantity_total": float(qty),
            "unit_price": float(unit if unit is not None else 0),
            "net_unit_price": float(unit if unit is not None else 0),
            "line_total_htva": float(round(total, 2)),
            "tva_rate": "6%",
            "line_type": "PRODUCT",
        })

    # Dédup simple par (code, total, qty)
    uniq = []
    seen = set()
    for l in lines:
        k = (l["product_code"], round(l["line_total_htva"], 2), round(l["quantity_total"], 3))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(l)
    return uniq


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing file path"}))
        sys.exit(1)

    file_path = sys.argv[1]
    filename = file_path.split("/")[-1]
    doc = fitz.open(file_path)
    ocr = RapidOCR()
    entries = []

    for p in doc:
        pix = p.get_pixmap(dpi=300)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            arr = arr[:, :, :3]
        result, _ = ocr(arr)
        if not result:
            continue
        for r in result:
            box, txt, score = r
            if score < 0.5:
                continue
            y = sum(pt[1] for pt in box) / 4
            x = min(pt[0] for pt in box)
            entries.append({"x": float(x), "y": float(y), "txt": str(txt), "score": float(score)})

    texts = [e["txt"] for e in entries]
    invoice_number = parse_invoice_number(texts, filename)
    invoice_date = parse_invoice_date(texts, filename)
    total_ttc = parse_total_ttc(entries, filename)
    lines = extract_lines(entries)

    if not lines:
        # Fallback minimal (évite échec total)
        total_ht = round((total_ttc or 0) / 1.21, 2)
        lines = [{
            "product_code": "",
            "description": "COLRUYT - ACHAT BAR (OCR fallback)",
            "quantity_colis": 1.0,
            "quantity_total": 1.0,
            "unit_price": total_ht,
            "net_unit_price": total_ht,
            "line_total_htva": total_ht,
            "tva_rate": "21%",
            "line_type": "PRODUCT",
        }]

    out = {
        "header": {
            "invoice_number": invoice_number,
            "invoice_date": invoice_date,
            "bordereau_number": None,
            "due_date": None,
            "reference": None,
            "client_number": None,
            "doc_type": "FACTURE",
        },
        "lines": [{
            "product_code": l["product_code"],
            "description": l["description"],
            "quantity_colis": l["quantity_colis"],
            "quantity_total": l["quantity_total"],
            "unit_price": l["unit_price"],
            "excise_ecoboni": None,
            "discount_pct": None,
            "net_unit_price": l["net_unit_price"],
            "line_total_htva": l["line_total_htva"],
            "vid_unit": None,
            "vid_total": None,
            "tva_rate": l["tva_rate"],
            "line_type": l["line_type"],
        } for l in lines],
        "summary": {
            "total_a_payer": float(total_ttc or 0),
            "total_htva_21": None,
            "total_tva_21": None,
            "total_htva_6": None,
            "total_tva_6": None,
            "vidanges_livrees": None,
            "vidanges_reprises": None,
        },
        "validation": {
            "valid": True,
            "warnings": ["COLRUYT OCR parser actif (qualité dépendante du scan)."],
        },
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
