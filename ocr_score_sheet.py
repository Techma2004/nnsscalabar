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
    import numpy as np
    import cv2
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
NAME_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z.'-]*$")


def normalize_name(s):
    """Collapse whitespace/punctuation so 'Jane  Doe.' and 'jane doe' compare equal."""
    return re.sub(r"[^a-z ]", "", (s or "").lower()).strip()
    

def remove_gridlines(img):
    """Real score sheets almost always come as a bordered table, and a full
    grid (row + column lines) badly corrupts Tesseract's character
    segmentation — border pixels merge into adjacent letters and produce
    garbage tokens instead of the actual text. This detects long straight
    horizontal/vertical runs via morphology, then keeps only the ones that
    span most of the image's width/height — a real table rule runs edge to
    edge, but even a tightly-kerned run of digits never does, which is what
    a plain length-based cutoff got wrong on smaller/denser text. Takes and
    returns a grayscale PIL Image."""
    arr = np.array(img)
    h, w = arr.shape
    bw = cv2.adaptiveThreshold(arr, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, 25, 15)

    def long_spanning_components(mask, axis, min_span_frac=0.5):
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        keep = np.zeros_like(mask)
        dim = w if axis == "h" else h
        span_col = cv2.CC_STAT_WIDTH if axis == "h" else cv2.CC_STAT_HEIGHT
        for i in range(1, n):  # 0 is background
            if stats[i, span_col] >= min_span_frac * dim:
                keep[labels == i] = 255
        return keep

    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, w // 40), 1))
    horiz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, h_kernel, iterations=1)
    horiz = long_spanning_components(horiz, "h")

    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, h // 40)))
    vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, v_kernel, iterations=1)
    vert = long_spanning_components(vert, "v")

    grid_mask = cv2.dilate(cv2.bitwise_or(horiz, vert), np.ones((3, 3), np.uint8), iterations=1)
    cleaned = arr.copy()
    cleaned[grid_mask > 0] = 255
    return Image.fromarray(cleaned)


def preprocess(image_path):
    """Light, dependency-free preprocessing to help OCR on real phone photos:
    grayscale + autocontrast, grid-line removal, and upscale small images
    since Tesseract does noticeably better with more pixels per character."""
    img = Image.open(image_path)
    img = img.convert("L")
    img = ImageOps.autocontrast(img)
    img = remove_gridlines(img)
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


def match_roster_name(words, start, roster_by_name, max_words=4):
    """Real score sheets almost always list the student's full name, not the
    system's internal user_code — try consuming 1..max_words consecutive
    word tokens starting at `start` and match the joined, normalised text
    against the roster's names. Returns (end_index, user_code) for the
    longest exact match, or (None, None)."""
    n = len(words)
    best = None
    for length in range(min(max_words, n - start), 0, -1):
        chunk = words[start:start + length]
        if not all(NAME_TOKEN_RE.match(w["text"]) for w in chunk):
            continue
        norm = normalize_name(" ".join(w["text"] for w in chunk))
        if norm in roster_by_name:
            best = (start + length - 1, roster_by_name[norm])
            break  # longest match wins (checked longest-first)
    return best or (None, None)


def parse_rows(lines, roster):
    # Build a name -> code lookup once. A duplicate name across two students
    # is genuinely ambiguous from a name-only sheet, so the first one wins
    # rather than guessing.
    roster_by_name = {}
    for code, full_name in roster.items():
        norm = normalize_name(full_name)
        if norm and norm not in roster_by_name:
            roster_by_name[norm] = code

    rows = []
    for words in lines:
        code_idx = None
        matched_code = None

        # 1) Older / ID-labelled sheets: a token that IS the user_code.
        for i, w in enumerate(words):
            candidate = match_roster_code(w["text"], roster)
            if candidate:
                code_idx = i
                matched_code = candidate
                break

        # 2) The common case: the sheet has no ID column at all, just an
        # S/N and the student's name. NAME_TOKEN_RE already rejects a
        # leading "1"/"3." S/N token as part of the name, so just try the
        # first few word positions in order and take the first that lines
        # up with a roster name — no need to specifically detect the S/N.
        if matched_code is None:
            for start in range(min(3, len(words))):
                end_idx, name_code = match_roster_name(words, start, roster_by_name)
                if name_code:
                    code_idx, matched_code = end_idx, name_code
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
