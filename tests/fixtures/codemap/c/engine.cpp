#include "engine/queue.h"
#include <vector>
#include <stdio.h>

// int ignored(int x) { return x; }
/* struct Phantom { int a; }; */
#define MAX_JOBS 64
#define SQUARE(x) ((x) * (x))

typedef unsigned long u64;
typedef void (*Callback)(int code);
typedef struct Point { int x; int y; } Point;

enum class Mode : int { Fast, Safe };

struct Node {
    int value;
};

static int helper(int n)
{
    return n * SQUARE(n);
}

int process(const Node *node, Callback cb)
{
    if (!node) return 0;
    cb(helper(node->value));
    return static_cast<int>(sizeof(Node));
}

const char *label = "class Fake { int y; }; int fake(void) {";

class Queue : public Base, private Logger
{
public:
    Queue(int cap);
    int size() const;
    void push(Node *n);
private:
    int count_ = 0;
};

Queue::Queue(int cap) : count_(cap)
{
    reset();
}

int Queue::size() const
{
    std::vector<int> tmp;
    tmp.push_back(count_);
    return tmp.size();
}

void Queue::push(Node *n)
{
    auto *copy = new Node(*n);
    emit(copy);
}

namespace net {

int connect(const char *host)
{
    return open_socket(host, MAX_JOBS);
}

}  // namespace net

extern "C" {

int legacy_entry(void)
{
    return net::connect("localhost");
}

}

template <typename T>
class Box : public Base
{
public:
    T get() const { return value_; }
};

int main(int argc, char **argv)
{
    auto q = Queue(argc);
    q.push(nullptr);
    if (argc > 1) return 1;
    return q.size();
}
