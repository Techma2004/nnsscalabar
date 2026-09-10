#!/usr/bin/env python3
import sys
import json
import re
from typing import Dict, List

REGISTERED_ROSTER: Dict[str, str] = {
    "AL001": "Student One",
    "AL002": "Student Two",
    "AL003": "Student Three",
    "AL004": "Student Four",
    "AL005": "Student Five",
}

def parse_tesseract_table(text: str) -> List[Dict]:
    rows = []
    lines = text.split("\n")
    data_start = None
    for i, line in enumerate(lines):
        if re.search(r"S/N.*USER.*CODE", line, re.IGNORECASE):
            data_start = i + 1
            break
    if data_start is None:
        data_start = 0
    pattern = re.compile(
        r"^\s*(\d+)\s*\|\s*([A-Z0-9_-]{3,20})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*\|\s*([0-1]\.[0-9]?)\s*\|\s*(.*)?$"
    )
    for line in lines[data_start:]:
        m = pattern.match(line.strip())
        if m:
            rows.append({
                "s/n": m.group(1),
                "user_code": m.group(2).upper(),
                "ca_score": m.group(3),
                "exam_score": m.group(4),
                "confidence": m.group(5) or "0.0",
                "note": m.group(6).strip() or "",
            })
    return rows

def enrich_rows(rows: List[Dict], roster: Dict[str, str]) -> List[Dict]:
    enriched = []
    for row in rows:
        uc = row["user_code"].upper()
        full_name = roster.get(uc, "Unknown Student")
        ca = None
        try:
            ca_val = int(row["ca_score"]) if row.get("ca_score_valid") else None
            if ca_val is not None and 0 <= ca_val <= 30: ca = ca_val
        except: pass
        exam = None
        try:
            exam_val = int(row["exam_score"]) if row.get("exam_score_valid") else None
            if exam_val is not None and 0 <= exam_val <= 70: exam = exam_val
        except: pass
        confidence = max(0.0, min(1.0, float(row.get("confidence", "0.5"))))
        note = row.get("note", "").strip()[:200]
        enriched.append({
            "user_code": uc,
            "full_name": full_name,
            "ca_score": ca,
            "exam_score": exam,
            "confidence": round(confidence, 2),
            "note": note,
            "valid_ca": ca is not None and 0 <= ca <= 30,
            "valid_exam": exam is not None and 0 <= exam <= 70,
        })
    return enriched

def main(tesseract_output: str = None, image_path: str = None):
    if tesseract_output:
        raw_text = tesseract_output
    elif image_path:
        try:
            import pytesseract
            from PIL import Image
            img = Image.open(image_path)
            raw_text = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
        except Exception as e:
            print(json.dumps({"error": f"Tesseract failed: {e}"}))
            sys.exit(1)
    else:
        print(json.dumps({"error": "Provide --text or image path"}))
        sys.exit(1)
    
    parsed = parse_tesseract_table(raw_text)
    enriched = enrich_rows(parsed, REGISTERED_ROSTER)
    valid = [r for r in enriched if r["full_name"] != "Unknown Student"]
    skipped = [r for r in enriched if r["full_name"] == "Unknown Student"]
    output = {
        "assignment_id": None,
        "term_id": None,
        "rows": valid,
        "roster_count": len(REGISTERED_ROSTER),
        "extracted_count": len(valid),
        "model": "Tesseract OCR",
        "generation_time": __import__("datetime").datetime.now().isoformat(),
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", type=str, help="Raw Tesseract output")
    parser.add_argument("image", nargs="?", type=str, help="Image path")
    args = parser.parse_args()
    main(tesseract_output=args.text, image_path=args.image)
