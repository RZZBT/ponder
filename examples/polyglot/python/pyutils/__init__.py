from pyutils.stack import IntStack


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))
