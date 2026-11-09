package com.example.algo;

/** Sorting algorithms. */
public final class Sorting {
    private Sorting() {}

    /** Sorts {@code a} in ascending order, in place, by inserting each element into the sorted part on its left. */
    public static void insertionSort(int[] a) {
        for (int i = 1; i < a.length; i++) {
            int key = a[i];
            int j = i - 1;
            while (j >= 0 && a[j] > key) {
                a[j + 1] = a[j];
                j--;
            }
            a[j + 1] = key;
        }
    }
}
