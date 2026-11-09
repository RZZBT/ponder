package demo;

import com.example.collections.IntStack;
import com.example.math.MathUtils;

public class Main {
    static int localClamp(int v, int a, int b) { return v; }

    public static void main(String[] args) {
        int a = MathUtils.clamp(-4, 0, 10);
        IntStack s = new IntStack(4);
        s.push(3);
        int b = localClamp(1, 2, 3);
        System.out.println(a + b);
    }
}
