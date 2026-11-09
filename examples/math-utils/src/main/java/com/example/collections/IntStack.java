package com.example.collections;

/** A fixed-capacity stack of ints: last in, first out. */
public final class IntStack {
    private final int[] items;
    private int size;

    /** Creates an empty stack that can hold {@code capacity} values. */
    public IntStack(int capacity) {
        this.items = new int[capacity];
    }

    /** Puts {@code value} on top. @throws IllegalStateException if the stack is full */
    public void push(int value) {
        if (size == items.length) throw new IllegalStateException("stack is full");
        items[size++] = value;
    }

    /** Removes and returns the value on top. @throws IllegalStateException if the stack is empty */
    public int pop() {
        if (size == 0) throw new IllegalStateException("stack is empty");
        return items[--size];
    }

    public int size() {
        return size;
    }
}
