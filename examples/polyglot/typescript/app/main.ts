import { clamp, IntStack } from '../ts-math/index';

function localClamp(v: number, a: number, b: number): number { return v; }

const a = clamp(-4, 0, 10);
const s = new IntStack();
s.push(3);
const b = localClamp(1, 2, 3);
console.log(a, b);
