local M = {}

function M.clamp(value, min, max)
  return math.max(min, math.min(max, value))
end

return M
