package com.example.algo;

/** Searching in arrays. */
public final class Search {
    private Search() {}

    /**
     * Finds {@code key} in an array sorted in ascending order by repeatedly halving the search range.
     *
     * @return the index of {@code key}, or -1 if it is not in the array
     */
    public static int binarySearch(int[] sorted, int key) {
        int lo = 0;
        int hi = sorted.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            if (sorted[mid] < key) lo = mid + 1;
            else if (sorted[mid] > key) hi = mid - 1;
            else return mid;
        }
        return -1;
    }
}
