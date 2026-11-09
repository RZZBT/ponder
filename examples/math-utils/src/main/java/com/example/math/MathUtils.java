package com.example.math;

/** Small numeric helpers. Most methods ship a Ponder animation (META-INF/ponder/ponder.json). */
public final class MathUtils {
    private MathUtils() {}

    /**
     * Restricts {@code value} to the closed interval [{@code minimum}, {@code maximum}].
     *
     * @return {@code minimum} if value is below it, {@code maximum} if above it, otherwise {@code value}
     * @throws IllegalArgumentException if {@code minimum > maximum}
     */
    public static int clamp(int value, int minimum, int maximum) {
        if (minimum > maximum) {
            throw new IllegalArgumentException("minimum (" + minimum + ") > maximum (" + maximum + ")");
        }
        return Math.max(minimum, Math.min(maximum, value));
    }

    /** No animation for this overload. */
    public static double clamp(double value, double minimum, double maximum) {
        if (minimum > maximum) {
            throw new IllegalArgumentException("minimum (" + minimum + ") > maximum (" + maximum + ")");
        }
        return Math.max(minimum, Math.min(maximum, value));
    }

    /** True if {@code minimum <= value <= maximum} (both ends included). */
    public static boolean isBetween(int value, int minimum, int maximum) {
        return value >= minimum && value <= maximum;
    }

    /** Greatest common divisor of two non-negative numbers, using Euclid's algorithm. */
    public static int gcd(int a, int b) {
        while (b != 0) {
            int remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }
}
