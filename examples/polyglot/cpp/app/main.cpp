#include "../cmath-lib/include/cmath_lib.hpp"
#include <cstdio>

static int local_clamp(int v, int, int) { return v; }

int main() {
    int a = cm::clamp(-4, 0, 10);
    cm::IntStack s;
    s.push(3);
    int b = local_clamp(1, 2, 3);
    std::printf("%d %d\n", a, b);
}
