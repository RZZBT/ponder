module RbMath
  def self.clamp(value, min, max)
    [[value, min].max, max].min
  end

  class IntStack
    def push(value)
      (@items ||= []) << value
    end
  end
end
