# Put the cursor on a function name and press Alt+W.
from mathutils import binary_search, clamp, factorial, gcd, insertion_sort, is_between, is_palindrome
from mathutils.stack import IntStack

from_library = clamp(-4, 0, 10)
inside = is_between(5, 3, 7)
divisor = gcd(48, 18)
index = binary_search([2, 5, 8, 12, 16, 23, 38, 56, 72, 91], 23)
same = is_palindrome("racecar")
ordered = insertion_sort([5, 2, 4, 6, 1, 3])
product = factorial(4)

stack = IntStack(4)
stack.push(3)
stack.push(8)
top = stack.pop()


# no animation for these
def local_clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


from_local = local_clamp(-4, 0, 10)
unrelated = abs(-3)

print(from_library, inside, divisor, index, same, ordered, product, top, from_local, unrelated)
