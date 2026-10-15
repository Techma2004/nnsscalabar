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


if __name__ == "__main__":
    unittest.main()
