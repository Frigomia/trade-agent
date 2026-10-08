"""ISIN validation: shape and the ISO 6166 check digit (Luhn over letters expanded to digits)."""

import re

_SHAPE = re.compile(r"[A-Z]{2}[A-Z0-9]{9}[0-9]")


def is_valid_isin(value: str) -> bool:
    # fullmatch, not match with ^...$: "$" also matches before a trailing newline.
    if not _SHAPE.fullmatch(value):
        return False
    digits = "".join(str(int(char, 36)) for char in value)  # A=10 ... Z=35
    total = 0
    for index, char in enumerate(reversed(digits)):
        n = int(char)
        if index % 2 == 1:
            n *= 2
            n = n // 10 + n % 10
        total += n
    return total % 10 == 0
