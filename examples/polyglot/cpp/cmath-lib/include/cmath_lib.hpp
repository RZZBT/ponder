#pragma once
#include <vector>

namespace cm {

inline int clamp(int value, int min, int max) {
    return value < min ? min : (value > max ? max : value);
}

class IntStack {
public:
    void push(int value) { items.push_back(value); }
private:
    std::vector<int> items;
};

}  // namespace cm
