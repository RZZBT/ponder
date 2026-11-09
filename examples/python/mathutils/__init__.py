"""Demo library for Ponder (Python)."""

from mathutils.stack import IntStack

__all__ = ["clamp", "is_between", "gcd", "binary_search", "is_palindrome", "insertion_sort", "factorial", "IntStack"]


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def is_between(value: int, minimum: int, maximum: int) -> bool:
    return minimum <= value <= maximum


def gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return abs(a)


def binary_search(items: list[int], key: int) -> int:
    lo, hi = 0, len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] < key:
            lo = mid + 1
        elif items[mid] > key:
            hi = mid - 1
        else:
            return mid
    return -1


def is_palindrome(s: str) -> bool:
    i, j = 0, len(s) - 1
    while i < j:
        if s[i] != s[j]:
            return False
        i, j = i + 1, j - 1
    return True


def insertion_sort(items: list[int]) -> list[int]:
    for i in range(1, len(items)):
        key = items[i]
        j = i - 1
        while j >= 0 and items[j] > key:
            items[j + 1] = items[j]
            j -= 1
        items[j + 1] = key
    return items


def factorial(n: int) -> int:
    return 1 if n <= 1 else n * factorial(n - 1)
