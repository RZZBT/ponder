from pyutils import clamp
from pyutils.stack import IntStack


def local_clamp(v: int, a: int, b: int) -> int:
    return v


x = clamp(-4, 0, 10)
s = IntStack()
s.push(3)
y = local_clamp(1, 2, 3)
print(x, y)
