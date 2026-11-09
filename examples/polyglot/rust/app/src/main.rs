use rmath::stack::IntStack;

fn local_clamp(v: i32, _a: i32, _b: i32) -> i32 {
    v
}

fn main() {
    let a = rmath::clamp(-4, 0, 10);
    let mut s = IntStack::new();
    s.push(3);
    let b = local_clamp(1, 2, 3);
    println!("{} {}", a, b);
}
