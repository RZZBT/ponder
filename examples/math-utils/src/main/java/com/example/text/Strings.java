package com.example.text;

/** String helpers. */
public final class Strings {
    private Strings() {}

    /** True if {@code s} reads the same forwards and backwards (case-sensitive). */
    public static boolean isPalindrome(String s) {
        int i = 0;
        int j = s.length() - 1;
        while (i < j) {
            if (s.charAt(i) != s.charAt(j)) return false;
            i++;
            j--;
        }
        return true;
    }
}
