<?php

require __DIR__ . '/../phpmath/src/Math.php';
require __DIR__ . '/../phpmath/src/IntStack.php';

use Acme\Math;
use Acme\IntStack;

function local_clamp(int $v, int $a, int $b): int { return $v; }

$a = Math::clamp(-4, 0, 10);
$s = new IntStack();
$s->push(3);
$b = local_clamp(1, 2, 3);
echo $a, $b;
