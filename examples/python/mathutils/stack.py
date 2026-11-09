class IntStack:
    """A fixed-capacity stack of integers."""

    def __init__(self, capacity: int) -> None:
        self._items: list[int] = []
        self._capacity = capacity

    def push(self, value: int) -> None:
        if len(self._items) == self._capacity:
            raise OverflowError("stack is full")
        self._items.append(value)

    def pop(self) -> int:
        if not self._items:
            raise IndexError("stack is empty")
        return self._items.pop()

    def size(self) -> int:
        return len(self._items)
