// Put the cursor on a function name and press Alt+W.
const { clamp, isBetween, gcd, binarySearch, isPalindrome, insertionSort, factorial, IntStack } = require('math-utils');

const fromLibrary = clamp(-4, 0, 10);
const inside = isBetween(5, 3, 7);
const divisor = gcd(48, 18);
const index = binarySearch([2, 5, 8, 12, 16, 23, 38, 56, 72, 91], 23);
const same = isPalindrome('racecar');
const sorted = insertionSort([5, 2, 4, 6, 1, 3]);
const product = factorial(4);

const stack = new IntStack(4);
stack.push(3);
stack.push(8);
const top = stack.pop();

// no animation for these
function localClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
const fromLocal = localClamp(-4, 0, 10);
const unrelated = Math.abs(-3);

console.log(fromLibrary, inside, divisor, index, same, sorted, product, top, fromLocal, unrelated);
