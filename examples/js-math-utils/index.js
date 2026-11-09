const { IntStack } = require('./lib/stack');

/** Returns value limited to the range [min, max]. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** True if min <= value <= max. */
function isBetween(value, min, max) {
  return value >= min && value <= max;
}

/** Greatest common divisor (Euclid). */
function gcd(a, b) {
  while (b !== 0) [a, b] = [b, a % b];
  return Math.abs(a);
}

/** Index of key in a sorted array, or -1. */
function binarySearch(sorted, key) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < key) lo = mid + 1;
    else if (sorted[mid] > key) hi = mid - 1;
    else return mid;
  }
  return -1;
}

function isPalindrome(s) {
  for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
  return true;
}

/** Sorts the array in place. */
function insertionSort(a) {
  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > key) a[j + 1] = a[j--];
    a[j + 1] = key;
  }
  return a;
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

module.exports = { clamp, isBetween, gcd, binarySearch, isPalindrome, insertionSort, factorial, IntStack };
