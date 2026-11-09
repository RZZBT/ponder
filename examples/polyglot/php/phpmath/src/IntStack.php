<?php

namespace Acme;

class IntStack
{
    private array $items = [];

    public function push(int $value): void
    {
        $this->items[] = $value;
    }
}
