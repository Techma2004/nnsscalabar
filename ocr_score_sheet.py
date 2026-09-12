#!/usr/bin/env python3
"""
NNSS Calabar — score-sheet OCR extraction (Tesseract-based).

Invoked by backend/routes/results.js as a subprocess:
    uv run ocr_score_sheet.py <image_path>
with the real class roster piped to stdin as JSON:
    {"STU2024001": "Jane Doe", "STU2024002": "John Smith", ...}

Prints a single JSON object to stdout:
    {
      "rows": [
        {"user_code": "...", "full_name": "...", "ca_score": 25, "exam_score": 60,
         "confidence": 0.93, "valid_ca": true, "valid_exam": true}
      ],
      "roster_count": 5,
      "extracted_count": 5,
      "model": "Tesseract OCR"
    }

Design notes:
- The roster is supplied by the caller (Node, reading the real database) —
  never hardcoded here. A row is only ever returned if its user_code matches
  a real roster entry.
- Confidence is Tesseract's own per-word confidence (0-100, from
  image_to_data), averaged over the words that made up the matched row and
  normalised to 0-1. It is not a fabricated number.
- Real photographed score sheets are whitespace-aligned text, not neat
  pipe-delimited tables, so rows are reconstructed from Tesseract's word-level
  layout data (grouped by block/paragraph/line, ordered left-to-right) rather
  than matched against a rigid line-level regex.
"""
import sys
import json
import re

try:
    import pytesseract
    from PIL import Image, ImageOps
except ImportError as e:
    print(json.dumps({"error": f"Missing Python dependency: {e}. Run: uv sync"}))
    sys.exit(1)

# Common OCR digit/letter confusions, applied only when trying a fallback
# match for a token that didn't match the roster exactly.
_CONFUSIONS = [
    ("O", "0"), ("0", "O"),
    ("I", "1"), ("1", "I"),
    ("l", "1"), ("S", "5"), ("B", "8"),
]

NUMERIC_RE = re.compile(r"^\d{1,3}$")


def preprocess(image_path):
    """Light, dependency-free preprocessing to help OCR on real phone photos:
    grayscale + autocontrast, and upscale small images since Tesseract does
    noticeably better with more pixels per character."""
    img = Image.open(image_path)
    img = img.convert("L")
    img = ImageOps.autocontrast(img)
    if img.width < 1400:
        scale = 1400 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img


def extract_words(image):
    """Run Tesseract in word-level data mode and group words into lines,
    preserving left-to-right reading order within each line."""
    data = pytesseract.image_to_data(image, config="--psm 6", output_type=pytesseract.Output.DICT)
    lines = {}
    n = len(data["text"])
    for i in range(n):
        text = data["text"][i].strip()
        if not text:
            continue
        conf = float(data["conf"][i])
        if conf < 0:  # Tesseract uses -1 for non-text regions
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append({"text": text, "left": data["left"][i], "conf": conf})
    ordered_lines = []
    for key in sorted(lines.keys()):
        words = sorted(lines[key], key=lambda w: w["left"])
        ordered_lines.append(words)
    return ordered_lines


def match_roster_code(token, roster):
    """Exact match first; fall back to a small set of common OCR-confusion
    substitutions, only accepting the fallback if it resolves to exactly one
    roster entry (never guess between two plausible candidates)."""
    code = token.upper().strip()
    if code in roster:
        return code
    candidates = set()
    for a, b in _CONFUSIONS:
        if a in code:
            candidates.add(code.replace(a, b))
    matches = [c for c in candidates if c in roster]
    if len(matches) == 1:
        return matches[0]
    return None


def parse_rows(lines, roster):
    rows = []
    for words in lines:
        code_idx = None
        matched_code = None
        for i, w in enumerate(words):
            candidate = match_roster_code(w["text"], roster)
            if candidate:
                code_idx = i
                matched_code = candidate
                break
        if matched_code is None:
            continue  # not a data row (header, title, blank line, unmatched noise)

        # Take the numeric tokens that appear after the matched code, in
        # left-to-right order: first is CA, second is EXAM. Ignore anything
        # before the code (that's the S/N column) and anything after the
        # second numeric token (stray marks, notes).
        numeric_after = [w for w in words[code_idx + 1:] if NUMERIC_RE.match(w["text"])]
        ca_word = numeric_after[0] if len(numeric_after) >= 1 else None
        exam_word = numeric_after[1] if len(numeric_after) >= 2 else None

        ca_score = int(ca_word["text"]) if ca_word else None
        exam_score = int(exam_word["text"]) if exam_word else None

        conf_values = [words[code_idx]["conf"]]
        if ca_word: conf_values.append(ca_word["conf"])
        if exam_word: conf_values.append(exam_word["conf"])
        confidence = round(sum(conf_values) / len(conf_values) / 100, 2)

        rows.append({
            "user_code": matched_code,
            "full_name": roster.get(matched_code),
            "ca_score": ca_score,
            "exam_score": exam_score,
            "confidence": confidence,
            "valid_ca": ca_score is not None and 0 <= ca_score <= 30,
            "valid_exam": exam_score is not None and 0 <= exam_score <= 70,
        })
    return rows


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ocr_score_sheet.py <image_path> (roster JSON piped via stdin)"}))
        sys.exit(1)
    image_path = sys.argv[1]

    try:
        roster_raw = sys.stdin.read()
        roster = json.loads(roster_raw) if roster_raw.strip() else {}
        if not isinstance(roster, dict):
            raise ValueError("roster must be a JSON object of {user_code: full_name}")
        roster = {str(k).upper().strip(): v for k, v in roster.items()}
    except Exception as e:
        print(json.dumps({"error": f"Invalid roster data: {e}"}))
        sys.exit(1)

    if not roster:
        print(json.dumps({"error": "No student roster was supplied for matching."}))
        sys.exit(1)

    try:
        image = preprocess(image_path)
    except Exception as e:
        print(json.dumps({"error": f"Could not read the image: {e}"}))
        sys.exit(1)

    try:
        lines = extract_words(image)
    except pytesseract.TesseractNotFoundError:
        print(json.dumps({"error": "Tesseract is not installed on this server. Ask an administrator to install tesseract-ocr."}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"OCR failed: {e}"}))
        sys.exit(1)

    rows = parse_rows(lines, roster)
    print(json.dumps({
        "rows": rows,
        "roster_count": len(roster),
        "extracted_count": len(rows),
        "model": "Tesseract OCR",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
