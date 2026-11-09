/** A fixed-capacity stack of integers. */
class IntStack {
  constructor(capacity) {
    this.items = new Array(capacity);
    this.count = 0;
  }

  push(value) {
    if (this.count === this.items.length) throw new Error('stack is full');
    this.items[this.count++] = value;
  }

  pop() {
    if (this.count === 0) throw new Error('stack is empty');
    return this.items[--this.count];
  }

  size() {
    return this.count;
  }
}

module.exports = { IntStack };
