package com.example.algo;

/** Recursive functions. */
public final class Recursion {
    private Recursion() {}

    /** n! = n * (n - 1) * ... * 1, computed recursively. {@code factorial(0)} and {@code factorial(1)} are 1. */
    public static long factorial(int n) {
        if (n < 0) throw new IllegalArgumentException("n must be >= 0");
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    }
}
