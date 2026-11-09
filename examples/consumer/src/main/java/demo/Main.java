package demo;

import com.example.algo.Recursion;
import com.example.algo.Search;
import com.example.algo.Sorting;
import com.example.collections.IntStack;
import com.example.math.MathUtils;
import com.example.text.Strings;

/** Put the caret on a method name and press Alt+W. */
public class Main {

    /** Same name as MathUtils.clamp, but declared here: no animation. */
    static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    public static void main(String[] args) {
        // simple
        int fromLibrary = MathUtils.clamp(-4, 0, 10);     // keeps a number inside a range
        boolean inside = MathUtils.isBetween(5, 3, 7);     // plays by itself (autoAdvance)

        // medium
        int divisor = MathUtils.gcd(48, 18);               // Euclid's algorithm
        int[] sorted = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        int index = Search.binarySearch(sorted, 23);       // halving the search range
        boolean same = Strings.isPalindrome("racecar");    // two pointers

        // complex
        int[] numbers = {5, 2, 4, 6, 1, 3};
        Sorting.insertionSort(numbers);                    // bars that move
        long product = Recursion.factorial(4);             // a recursive call stack

        // constructor and instance methods
        IntStack stack = new IntStack(4);                  // put the caret on IntStack
        stack.push(3);
        stack.push(8);
        stack.push(5);                                     // push
        int top = stack.pop();                             // pop

        // no animation for these
        int fromLocal = clamp(-4, 0, 10);                  // same name, but a local method
        double overload = MathUtils.clamp(1.5, 0.0, 1.0);  // other overload, no animation
        int unrelated = Math.abs(-3);                      // a JDK method

        System.out.println(fromLibrary + " " + inside + " " + divisor + " " + index + " " + same + " "
            + product + " " + top + " " + stack.size() + " " + fromLocal + " " + overload + " " + unrelated);
    }
}
