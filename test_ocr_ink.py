"""Pen-ink handling in the score sheet reader (run: python3 -m unittest test_ocr_ink)."""
import unittest
import numpy as np
from PIL import Image
import ocr_score_sheet as ocr


def page_with(ink):
    arr = np.full((60, 60, 3), (250, 248, 242), np.uint8)
    arr[20:40, 28:32] = ink  # a vertical pen stroke
    return Image.fromarray(arr, "RGB")


class InkGray(unittest.TestCase):
    def test_pen_colours_become_dark_against_paper(self):
        for name, ink in {"blue pen": (90, 130, 215), "dark blue": (40, 70, 190), "black pen": (25, 25, 30)}.items():
            g = ocr.ink_gray(page_with(ink))
            self.assertLess(int(g[30, 30]), 140, name)
            self.assertGreater(int(g[5, 5]), 230, name)

    def test_pale_blue_stands_out_more_than_plain_luminance(self):
        img = page_with((90, 130, 215))
        self.assertLess(int(ocr.ink_gray(img)[30, 30]), int(ocr.ink_gray(img, mode="luma")[30, 30]))

    def test_thicken_widens_a_stroke(self):
        img = page_with((25, 25, 30))
        self.assertGreater((ocr.ink_gray(img, thicken=True) < 128).sum(), (ocr.ink_gray(img) < 128).sum())


class LocateTesseract(unittest.TestCase):
    def test_explicit_setting_wins(self):
        self.assertEqual(ocr.locate_tesseract({"TESSERACT_CMD": '"D:\\ocr\\tesseract.exe"'}, which=lambda n: "/usr/bin/tesseract"), "D:\\ocr\\tesseract.exe")

    def test_on_path_keeps_default_lookup(self):
        self.assertIsNone(ocr.locate_tesseract({}, which=lambda n: "/usr/bin/tesseract"))

    def test_finds_standard_windows_folder_when_not_on_path(self):
        env = {"ProgramFiles": "C:\\Program Files"}
        want = __import__("os").path.join("C:\\Program Files", "Tesseract-OCR", "tesseract.exe")
        self.assertEqual(ocr.locate_tesseract(env, which=lambda n: None, isfile=lambda p: p == want), want)

    def test_nothing_found_returns_none(self):
        self.assertIsNone(ocr.locate_tesseract({"ProgramFiles": "C:\\Program Files"}, which=lambda n: None, isfile=lambda p: False))


if __name__ == "__main__":
    unittest.main()
