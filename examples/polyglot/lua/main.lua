package.path = "lmath/?.lua;" .. package.path
local lmath = require("lmath")
local IntStack = require("stack")

local function local_clamp(v, a, b) return v end

local a = lmath.clamp(-4, 0, 10)
local s = IntStack.new()
s:push(3)
local b = local_clamp(1, 2, 3)
print(a, b)
