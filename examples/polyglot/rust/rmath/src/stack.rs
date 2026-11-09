pub struct IntStack {
    items: Vec<i32>,
}

impl IntStack {
    pub fn new() -> Self {
        IntStack { items: Vec::new() }
    }

    pub fn push(&mut self, value: i32) {
        self.items.push(value);
    }
}
