local IntStack = {}
IntStack.__index = IntStack

function IntStack.new()
  return setmetatable({ items = {} }, IntStack)
end

function IntStack:push(value)
  table.insert(self.items, value)
end

return IntStack
