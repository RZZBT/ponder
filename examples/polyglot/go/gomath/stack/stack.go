package stack

type IntStack struct{ items []int }

func (s *IntStack) Push(v int) { s.items = append(s.items, v) }
