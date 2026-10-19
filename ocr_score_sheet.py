#!/usr/bin/env python3
"""
NNSS Calabar — score-sheet OCR extraction (Tesseract-based).

Invoked by backend/routes/results.js as a subprocess:
    uv run ocr_score_sheet.py <image_path>
with the real class roster (and the score limits) piped to stdin as JSON:
    {"roster": {"STU2024001": "Jane Doe", ...},
     "limits": {"test1": 15, "quiz": 5, "assignment": 5, "test2": 5,
                "project": 5, "note": 5, "exam": 60}}
(A bare {"STU2024001": "Jane Doe", ...} roster is still accepted.)

It reads the school's Continuous Assessment Sheet, whose columns are
    1ST TEST | QUIZ | ASSIGNMENT | TOTAL | 2ND TEST | PROJECT | NOTE | TOTAL | EXAM | TERM'S TOTAL | GRADE
 
Prints a single JSON object to stdout:
    {
      "rows": [
        {"user_code": "...", "full_name": "...",
         "scores": {"test1": 12, "quiz": 4, "assignment": 5, "test2": 4,
                    "project": 5, "note": 3, "exam": 48},
         "confidence": 0.93, "note": ""}
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
import os
import sys
import json
import re
import shutil
import difflib

try:
    import pytesseract
    from PIL import Image
    import numpy as np
    import cv2
except ImportError as e:
    print(json.dumps({"error": f"Missing Python dependency: {e}. Run: uv sync"}))
    sys.exit(1)

def locate_tesseract(environ=None, which=shutil.which, isfile=os.path.isfile):
    """Where is tesseract.exe? The Windows installer does not put Tesseract on
    PATH, so the scanner would otherwise fail with "not installed" even though
    it is. Order: the TESSERACT_CMD setting; PATH (return None = pytesseract's
    default lookup, so Linux/macOS behave exactly as before); then the standard
    Windows install folders. Returns a path, or None to use the default."""
    env = os.environ if environ is None else environ
    explicit = (env.get("TESSERACT_CMD") or "").strip().strip('"')
    if explicit:
        return explicit
    if which("tesseract"):
        return None
    folders = [os.path.join(env[k], "Tesseract-OCR") for k in ("ProgramFiles", "ProgramFiles(x86)") if env.get(k)]
    if env.get("LOCALAPPDATA"):
        folders.append(os.path.join(env["LOCALAPPDATA"], "Programs", "Tesseract-OCR"))
    for folder in folders:
        candidate = os.path.join(folder, "tesseract.exe")
        if isfile(candidate):
            return candidate
    return None


_tesseract_path = locate_tesseract()
if _tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = _tesseract_path

# Common OCR digit/letter confusions, applied only when trying a fallback
# match for a token that didn't match the roster exactly.
_CONFUSIONS = [
    ("O", "0"), ("0", "O"),
    ("I", "1"), ("1", "I"),
    ("l", "1"), ("S", "5"), ("B", "8"),
]

NUMERIC_RE = re.compile(r"^\d{1,3}(?:[.,]\d{1,2})?$")

SCORE_KEYS = ["test1", "quiz", "assignment", "test2", "project", "note", "exam"]
DEFAULT_LIMITS = {"test1": 15, "quiz": 5, "assignment": 5, "test2": 5, "project": 5, "note": 5, "exam": 60}
NAME_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z.'-]*$")


# Tesseract frequently reads a capital "I" in bold sans-serif print as "!" or "|"
# (e.g. "OKOLOSI" -> "OKOLOS!"). Repair those before judging whether a token is
# a name word, otherwise the whole row is dropped.
_NAME_FIXES = str.maketrans({"!": "I", "|": "I", "\u00a1": "I"})


def clean_name_token(text):
    return text.translate(_NAME_FIXES)


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


def enhance_contrast(arr):
    """Global autocontrast treats the whole image as one lighting condition,
    which real phone photos of paper rarely are — a shadow across half the
    page, or glare in one corner, means faint pencil/pen strokes in the dim
    area stay faint no matter how the brightest pixels are stretched. CLAHE
    equalizes contrast in local tiles instead, so a dim corner and a bright
    corner both get proper contrast independently."""
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    return clahe.apply(arr)


def deskew(arr):
    """A few degrees of camera tilt is enough to throw off Tesseract's
    line-grouping, which assumes roughly horizontal rows. Estimate the tilt
    from the text mask and correct it — but only when the estimate is both
    clearly non-zero and small enough to trust as real skew rather than
    noise from a sparse or near-empty image, since a bad correction is worse
    than none."""
    bw = cv2.adaptiveThreshold(arr, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, 25, 15)
    coords = cv2.findNonZero(bw)
    if coords is None or len(coords) < 200:
        return arr
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    elif angle > 45:
        angle = angle - 90
    else:
        angle = -angle
    if abs(angle) < 0.4 or abs(angle) > 12:
        return arr
    h, w = arr.shape
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(arr, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


# Bound decoded image size, not just compressed upload size. A small compressed
# image can expand to gigabytes of pixels and exhaust memory during OCR.
MAX_IMAGE_PIXELS = 25_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


MAX_PDF_PAGES = 6        # a class sheet is one or two pages; refuse to grind through a huge document
PDF_RENDER_SCALE = 200 / 72  # render PDF pages at ~200 dpi


def load_pages(path):
    """Returns the list of PIL images to read: one for a photo, one per page for a PDF
    (CamScanner and similar apps export PDFs)."""
    with open(path, "rb") as fh:
        is_pdf = fh.read(5) == b"%PDF-"
    if not is_pdf:
        with Image.open(path) as source:
            if source.width < 1 or source.height < 1 or source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("Image dimensions are too large for safe OCR. Resize it and try again.")
            return [source.convert("RGB")]
    try:
        import pypdfium2 as pdfium
    except ImportError as e:
        raise ValueError(f"PDF support is not installed on this server ({e}). Run: uv sync") from e
    pdf = pdfium.PdfDocument(path)
    try:
        if len(pdf) > MAX_PDF_PAGES:
            raise ValueError(f"This PDF has {len(pdf)} pages; scan one class sheet (up to {MAX_PDF_PAGES} pages) at a time.")
        pages = []
        for index in range(len(pdf)):
            page = pdf[index]
            width, height = page.get_size()
            if width * height * PDF_RENDER_SCALE ** 2 > MAX_IMAGE_PIXELS:
                raise ValueError("A PDF page is too large for safe OCR.")
            pages.append(page.render(scale=PDF_RENDER_SCALE).to_pil().convert("RGB"))
        return pages
    finally:
        pdf.close()


def ink_gray(img, thicken=False, mode="ink"):
    """Teachers fill score sheets in pen, usually blue or black, so the pen has
    to survive the conversion to grey. A plain luminance conversion turns pale
    blue ballpoint into a mid-grey that barely stands out. Blue ink is dark in
    the red and green channels while white paper is bright in all of them, and
    black ink is dark in all three - so the darkest channel at each pixel is a
    clear 'ink' signal for blue pen, black pen and pencil alike. Optionally
    thickens strokes, which helps thin ballpoint lines that become hairlines
    once the photo is downscaled."""
    if img.mode == "L" or mode == "luma":
        arr = np.array(img.convert("L"))
    else:
        rgb = np.array(img.convert("RGB"))
        arr = rgb.min(axis=2)
    if thicken:
        arr = cv2.erode(arr, np.ones((2, 2), np.uint8), iterations=1)  # erode on grey = thicken dark strokes
    return arr


def preprocess(image_path, thicken=False, mode="ink"):
    """Preprocessing tuned for real phone photos of paper, including messy
    handwriting in blue or black pen: ink-aware grey conversion, local contrast
    correction for uneven lighting, light denoising, deskewing, grid-line
    removal, then upscaling small images since Tesseract does noticeably
    better with more pixels per character."""
    img = image_path if isinstance(image_path, Image.Image) else load_pages(image_path)[0]
    arr = ink_gray(img, thicken, mode)
    arr = enhance_contrast(arr)
    arr = cv2.medianBlur(arr, 3)
    arr = deskew(arr)
    img = remove_gridlines(Image.fromarray(arr))
    if img.width < 1400:
        scale = 1400 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return img


def extract_words(image, psm=6):
    """Run Tesseract in word-level data mode and group words into lines,
    preserving left-to-right reading order within each line."""
    data = pytesseract.image_to_data(image, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
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
        texts = [clean_name_token(w["text"]) for w in chunk]
        if not all(NAME_TOKEN_RE.match(t) for t in texts):
            continue
        norm = normalize_name(" ".join(texts))
        if norm in roster_by_name:
            best = (start + length - 1, roster_by_name[norm])
            break  # longest match wins (checked longest-first)
    return best or (None, None)


FUZZY_CUTOFF = 0.88   # similarity needed to accept an approximate name match
FUZZY_MARGIN = 0.04   # the best candidate must beat the runner-up by at least this much


def match_roster_name_fuzzy(words, start, roster_by_name, max_words=6):
    """Fallback for when a name is read with a wrong or missing letter. Only
    accepts a match that is both close AND clearly better than every other
    student's name, so a blurry row is never quietly assigned to a lookalike.
    Returns (end_index, user_code) or (None, None); the caller flags the row
    so the teacher checks the student before submitting."""
    run = []
    for w in words[start:start + max_words]:
        t = clean_name_token(w["text"])
        if not NAME_TOKEN_RE.match(t):
            break
        run.append(t)
    best = None
    for length in range(2, len(run) + 1):
        norm = normalize_name(" ".join(run[:length]))
        if len(norm) < 6:
            continue
        scored = sorted(((difflib.SequenceMatcher(None, norm, cand).ratio(), cand) for cand in roster_by_name), reverse=True)
        top, runner = scored[0], (scored[1][0] if len(scored) > 1 else 0.0)
        if top[0] >= FUZZY_CUTOFF and top[0] - runner >= FUZZY_MARGIN and (best is None or top[0] > best[0]):
            best = (top[0], start + length - 1, roster_by_name[top[1]])
    return (best[1], best[2]) if best else (None, None)


def to_number(text):
    n = float(text.replace(",", "."))
    return int(n) if n == int(n) else n


def map_sheet_numbers(tokens):
    """Map the numbers read left-to-right on one row to the sheet's columns.

    The printed sheet reads  T1 Quiz Assign [TOTAL] T2 Project Note [TOTAL] Exam [TERM'S TOTAL]
    (GRADE is a letter, so it never matches NUMERIC_RE). Only layouts that can be
    mapped without guessing are accepted: 10 numbers (everything printed), 9
    (term total missing) or 7 (a sheet with no total columns). Anything else is
    returned unmapped, with a note, for the teacher to fill in by hand.
    """
    nums = [to_number(t["text"]) for t in tokens]
    n = len(nums)
    empty = {k: None for k in SCORE_KEYS}
    if n >= 9:
        idx = [0, 1, 2, 4, 5, 6, 8]
        used = tokens[: min(n, 10)]
    elif n == 7:
        idx = list(range(7))
        used = tokens
    else:
        return empty, [], f"Read {n} of the 7 score columns - enter this row by hand."
    values = dict(zip(SCORE_KEYS, [nums[i] for i in idx]))
    note = ""
    if n >= 9:
        ca1_ok = abs(nums[3] - (nums[0] + nums[1] + nums[2])) < 0.01
        ca2_ok = abs(nums[7] - (nums[4] + nums[5] + nums[6])) < 0.01
        total_ok = n < 10 or abs(nums[9] - (nums[3] + nums[7] + nums[8])) < 0.01
        if not (ca1_ok and ca2_ok and total_ok):
            note = "Printed totals do not match the scores read - check this row."
    return values, used, note


def within_limits(values, limits):
    return all(values[k] is not None and 0 <= values[k] <= limits[k] for k in SCORE_KEYS)


def parse_rows(lines, roster, limits):
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

        fuzzy = False
        if matched_code is None:
            for start in range(min(3, len(words))):
                end_idx, name_code = match_roster_name_fuzzy(words, start, roster_by_name)
                if name_code:
                    code_idx, matched_code, fuzzy = end_idx, name_code, True
                    break

        if matched_code is None:
            continue  # not a data row (header, title, blank line, unmatched noise)

        # Numbers after the matched name, left to right, are the score columns.
        # Anything before it is the S/N column.
        numeric_after = [w for w in words[code_idx + 1:] if NUMERIC_RE.match(w["text"])]
        values, used, note = map_sheet_numbers(numeric_after)

        conf_values = [words[code_idx]["conf"]] + [w["conf"] for w in used]
        confidence = round(sum(conf_values) / len(conf_values) / 100, 2)

        if fuzzy:
            confidence = min(confidence, 0.6)
            note = ("Name matched approximately - check this is the right student. " + note).strip()
        rows.append({
            "user_code": matched_code,
            "full_name": roster.get(matched_code),
            "scores": values,
            "confidence": confidence,
            "note": note,
            "_ok": within_limits(values, limits) and not note,
        })
    return rows


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ocr_score_sheet.py <image_path> (roster JSON piped via stdin)"}))
        sys.exit(1)
    image_path = sys.argv[1]

    limits = dict(DEFAULT_LIMITS)
    try:
        roster_raw = sys.stdin.read()
        payload = json.loads(roster_raw) if roster_raw.strip() else {}
        if not isinstance(payload, dict):
            raise ValueError("roster must be a JSON object of {user_code: full_name}")
        if "roster" in payload and isinstance(payload["roster"], dict):
            roster = payload["roster"]
            for k, v in (payload.get("limits") or {}).items():
                if k in limits:
                    limits[k] = float(v)
        else:
            roster = payload
        roster = {str(k).upper().strip(): v for k, v in roster.items()}
    except Exception as e:
        print(json.dumps({"error": f"Invalid roster data: {e}"}))
        sys.exit(1)

    if not roster:
        print(json.dumps({"error": "No student roster was supplied for matching."}))
        sys.exit(1)

    try:
        pages = load_pages(image_path)
    except Exception as e:
        print(json.dumps({"error": f"Could not read the file: {e}"}))
        sys.exit(1)

    # Try the fast, structured-table config first; only spend time on the
    # sparser/less-structured configs if it clearly under-performed against
    # the class roster. Selection is by how many rows come out with ALL seven
    # scores readable and inside their limits, not raw row count - a
    # sparse-text config can produce more matched names by fragmenting the
    # table into extra rows while losing the scores that sit beside each name,
    # which raw-count selection would wrongly prefer.
    def filled_cells(rows):
        return sum(1 for r in rows for v in r["scores"].values() if v is not None)

    def count_valid(rows):
        return sum(1 for r in rows if r["_ok"])

    def read_variant(page, thicken, mode):
        image = preprocess(page, thicken, mode)
        best_rows, best_valid = [], -1
        for psm in (6, 4, 11):
            try:
                lines = extract_words(image, psm=psm)
            except pytesseract.TesseractNotFoundError:
                print(json.dumps({"error": "Tesseract is not installed on this server (or is not on PATH). Ask an administrator to install tesseract-ocr, or set TESSERACT_CMD in backend/.env to the full path of tesseract.exe."}))
                sys.exit(1)
            except Exception as e:
                if not best_rows and psm == 6:
                    print(json.dumps({"error": f"OCR failed: {e}"}))
                    sys.exit(1)
                continue
            rows = parse_rows(lines, roster, limits)
            valid = count_valid(rows)
            if (valid, filled_cells(rows)) > (best_valid, filled_cells(best_rows)):
                best_rows, best_valid = rows, valid
            if best_valid >= len(roster):
                break
        return best_rows, best_valid

    def read_page(page):
        # Ink-aware grey first (blue or black pen); if the roster is not fully
        # read, retry with the plain luminance conversion and with thickened
        # strokes (thin ballpoint lines), keeping whichever variant read the
        # most rows completely and, on a tie, the most score cells.
        best_rows, best_valid = [], -1
        for thicken, mode in ((False, "ink"), (False, "luma"), (True, "ink")):
            rows, valid = read_variant(page, thicken, mode)
            if (valid, filled_cells(rows)) > (best_valid, filled_cells(best_rows)):
                best_rows, best_valid = rows, valid
            if best_valid >= len(roster):
                break
        return best_rows

    # A student can appear on more than one page of a multi-page PDF (or twice on
    # one page if a line is read twice). Keep the better-read copy; the portal's
    # review table still flags any remaining duplicates for the teacher.
    merged = {}
    try:
        for page in pages:
            for row in read_page(page):
                prev = merged.get(row["user_code"])
                if prev is None or (row["_ok"], row["confidence"]) > (prev["_ok"], prev["confidence"]):
                    merged[row["user_code"]] = row
    except Exception as e:
        print(json.dumps({"error": f"Could not read the file: {e}"}))
        sys.exit(1)
    best_rows = list(merged.values())
    rows = [{k: v for k, v in r.items() if k != "_ok"} for r in best_rows]
    print(json.dumps({
        "rows": rows,
        "roster_count": len(roster),
        "extracted_count": len(rows),
        "model": "Tesseract OCR",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
