-- The OOP topic in Python, matching the Design Patterns topic beside it.
--
-- Not a translation. Three parts of lesson 1 taught Java's model rather than
-- object orientation, and a Python snippet under them would have contradicted
-- the prose above it: Python has no access modifiers, no method overloading,
-- and unlike Java it *permits* multiple inheritance and resolves the diamond
-- with the MRO instead of forbidding it. Those sections say what Python
-- actually does, which is better interview material for somebody who writes
-- Python than a faithful translation would have been.
--
-- SOLID and composition needed no such care: both are language-neutral, so
-- those are straight swaps.
--
-- Every replacement is exact text lifted from the rows themselves, which makes
-- each one idempotent for free: after the first run the Java is gone, so
-- `replace` finds nothing and changes nothing.


-- ── The 4 Pillars & Class Relationships ───────────────────────────────────────────

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
class BankAccount {
    private double balance;            // can't be set directly
    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
```$body$,
  $body$```python
class BankAccount:
    def __init__(self) -> None:
        self._balance = 0.0            # the underscore says "not yours to touch"

    def deposit(self, amount: float) -> None:
        if amount <= 0:
            raise ValueError("deposit must be positive")
        self._balance += amount

    @property
    def balance(self) -> float:        # readable, and there is no setter
        return self._balance
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
abstract class Shape {
    // subclasses must implement this
    abstract double area();
    // shared concrete method, inherited by every subclass
    void printArea() { System.out.println(area()); }
}
class Circle extends Shape {
    double radius;
    double area() { return Math.PI * radius * radius; }
}
```$body$,
  $body$```python
from abc import ABC, abstractmethod
import math

class Shape(ABC):
    @abstractmethod
    def area(self) -> float:           # subclasses must implement this
        ...

    def print_area(self) -> None:      # shared concrete method, inherited
        print(self.area())

class Circle(Shape):
    def __init__(self, radius: float) -> None:
        self.radius = radius

    def area(self) -> float:
        return math.pi * self.radius**2

Shape()      # TypeError: instantiating an abstract class is refused
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
interface Serializable {
    String serialize();
    void deserialize(String data);
}
```$body$,
  $body$```python
from typing import Protocol

class Serializable(Protocol):
    def serialize(self) -> str: ...
    def deserialize(self, data: str) -> None: ...

# Nothing declares that it implements this. Any class with both methods
# already satisfies it, which a type checker verifies at the call site.
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
class Animal {
    String name;
    void eat() { System.out.println(name + " is eating"); }
}
class Dog extends Animal {
    // Dog gets eat() for free; bark() is its own extension
    void bark() { System.out.println(name + " is barking"); }
    // overriding: replace the parent's version
    @Override
    void eat() { System.out.println("Dog gulps food"); }
}
```$body$,
  $body$```python
class Animal:
    def __init__(self, name: str) -> None:
        self.name = name

    def eat(self) -> None:
        print(f"{self.name} is eating")

class Dog(Animal):
    # Dog gets eat() for free; bark() is its own extension
    def bark(self) -> None:
        print(f"{self.name} is barking")

    # overriding: replace the parent's version
    def eat(self) -> None:
        print("Dog gulps food")
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
Animal a = new Dog();
a.speak();   // runs Dog's speak(), decided at RUNTIME
```$body$,
  $body$```python
a: Animal = Dog("Rex")
a.speak()    # runs Dog's speak, decided at RUNTIME by the object's real type
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
class House {
    private Room bedroom = new Room();   // composition, Room dies with House
}
```$body$,
  $body$```python
class House:
    def __init__(self) -> None:
        self._bedroom = Room()           # composition, the Room dies with the House
```$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$restrict direct access to the data with **access modifiers** [keywords
on a field or method saying who may touch it]. Java has four levels:

- `private`: only inside the class
- *(no modifier)*: same package only (Java's "package-private" default)
- `protected`: subclasses plus same package
- `public`: anyone$body$,
  $body$restrict direct access to the data. Languages like Java do that with
**access modifiers** [keywords saying who may touch a field]. **Python has
none**, and leans on one convention plus one real mechanism:

- `name`: public, and the default
- `_name`: internal by convention. Nothing stops you, and that is the point:
  it is a message to the next reader, not a lock
- `__name`: **name mangling**, rewritten to `_Class__name`, which prevents a
  subclass colliding with it by accident rather than preventing access
- `@property`: the one that does real work, keeping an attribute readable
  while routing every write through validation

Say this out loud in an interview if you write Python: encapsulation is
enforced by design and review here, not by the compiler, and the class is
still the single place the rules live.$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$**Compile-time polymorphism (method overloading)**: same method name,
different parameters; the compiler picks the version by looking at the
arguments.

```java
class Calculator {
    int add(int a, int b) { return a + b; }
    double add(double a, double b) { return a + b; }
}
```$body$,
  $body$**Compile-time polymorphism (method overloading)**: same method name,
different parameters, and the compiler picks a version by looking at the
arguments. **Python does not have it.** A later `def` of the same name
replaces the earlier one, and usually nothing is lost, because one
dynamically typed function already handles both:

```python
class Calculator:
    def add(self, a, b):
        return a + b        # ints, floats, even strings: same code
```

When behaviour genuinely has to differ by type, the answer is a *runtime*
dispatch:

```python
from functools import singledispatchmethod

class Formatter:
    @singledispatchmethod
    def show(self, value) -> str:
        return str(value)

    @show.register
    def _(self, value: list) -> str:
        return ", ".join(map(str, value))
```

Worth saying plainly: **Python collapses the two kinds into one.** Both of
its dispatch mechanisms decide at runtime, so the compile-time half of this
distinction is a Java and C++ idea you should be able to name rather than
one you will use here.$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$**Why only one superclass? The diamond problem.** If `D` could extend both
`B` and `C`, and each of them overrides the same inherited method, which
version does `D` get? There is no good answer, so Java avoids the ambiguity
by allowing one superclass only. Implementing many interfaces is safe
because interfaces carry no state; and if two default methods clash, the
compiler forces the class to override the method and choose.

> **Interview phrasing:** "Java forbids multiple class inheritance because
> of the diamond problem. Multiple interfaces are safe because they carry
> no state, and a clash between default methods is a compile error the
> class must resolve by overriding."$body$,
  $body$**The diamond problem, and Python's answer.** If `D` inherits from both `B`
and `C` and each overrides the same method, which one does `D` get? Java
sidesteps the question by allowing one superclass only. **Python allows
multiple inheritance and answers it instead**, with the **MRO** [method
resolution order: the single, fixed order in which Python searches an
object's classes]:

```python
class B(A): ...
class C(A): ...
class D(B, C): ...

D.__mro__     # (D, B, C, A, object): one order, computable, no ambiguity
```

The order is worked out by an algorithm called C3 linearisation, and it
guarantees two things: a class always comes before its parents, and the
order you wrote the bases in is preserved. If no such order exists, the
class raises `TypeError` at definition time rather than doing something
surprising later.

> **Interview phrasing:** "Java forbids multiple class inheritance because
> of the diamond problem. Python permits it and resolves it with the MRO, a
> C3 linearisation that puts every class before its parents and fails loudly
> at class creation when no consistent order exists. That is why cooperative
> `super()` calls work in a diamond and why mixins are idiomatic in Python
> and awkward in Java."$body$)
WHERE title = 'The 4 Pillars & Class Relationships';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$| | Abstract class | Interface |
|---|---|---|
| State (fields) | Yes | No (constants only) |
| Constructor | Yes | No |
| Implementation | Partial | None (or default methods, Java 8+) |
| Multiple inheritance | No, one only | Yes, implement many |
| Use when | Sharing code among related classes | A contract for unrelated classes |

Rule of thumb: **abstract class = "is-a" with shared code; interface =
"can-do" contract.** `Dog extends Animal` (is-a); `Dog implements
Serializable` (can-do).$body$,
  $body$Python's pair is `ABC` and `Protocol`, and they split on a different axis
than Java's: not what they may contain, but **who has to know about whom**.

| | `ABC` | `Protocol` |
|---|---|---|
| State and constructor | Yes | No |
| Shared implementation | Yes | No, signatures only |
| The class must declare it | Yes, it subclasses the ABC | No |
| Checked | At instantiation, loudly | By a type checker, statically |
| Use when | sharing code among related classes | a contract across unrelated ones |

Rule of thumb: **`ABC` = "is-a" with shared code; `Protocol` = "can-do"
contract.** `class Dog(Animal)` is is-a. A `Dog` that happens to have
`serialize` already satisfies a `Serializable` protocol without saying so,
which is **structural typing**: the shape is the contract, so you can apply
one to a class you do not own, including somebody else's library.$body$)
WHERE title = 'The 4 Pillars & Class Relationships';


-- ── SOLID Principles ───────────────────────────────────────────

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
class UserService {
    void registerUser(User u)     { /* saves to DB */ }
    void sendWelcomeEmail(User u) { /* email */ }      // not its job
    void generateReport()         { /* reporting */ }  // not its job
}
```$body$,
  $body$```python
class UserService:
    def register_user(self, user: User) -> None: ...   # saves to the database
    def send_welcome_email(self, user: User) -> None: ...   # not its job
    def generate_report(self) -> None: ...                  # not its job
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Violation: adding a discount type means editing this method
class DiscountCalculator {
    double calculate(String type, double price) {
        if (type.equals("VIP"))    return price * 0.8;
        if (type.equals("Member")) return price * 0.9;
        return price;
    }
}
```$body$,
  $body$```python
# Violation: adding a discount type means editing this method
class DiscountCalculator:
    def calculate(self, kind: str, price: float) -> float:
        if kind == "VIP":
            return price * 0.8
        if kind == "Member":
            return price * 0.9
        return price
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Fix: each discount is its own class behind one interface
interface DiscountStrategy { double apply(double price); }

class VIPDiscount implements DiscountStrategy {
    public double apply(double p) { return p * 0.8; }
}
class StudentDiscount implements DiscountStrategy {
    public double apply(double p) { return p * 0.85; }
}
// A new discount is a new class; existing code stays untouched.
```$body$,
  $body$```python
# Fix: each discount is its own class behind one protocol
from typing import Protocol

class DiscountStrategy(Protocol):
    def apply(self, price: float) -> float: ...

class VIPDiscount:
    def apply(self, price: float) -> float:
        return price * 0.8

class StudentDiscount:
    def apply(self, price: float) -> float:
        return price * 0.85

# A new discount is a new class; existing code stays untouched. Neither class
# names the protocol: having the method is what satisfies it.
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Classic violation: Square extends Rectangle
class Square extends Rectangle {
    void setWidth(int w)  { this.width = w; this.height = w; }
    void setHeight(int h) { this.width = h; this.height = h; }
}

Rectangle r = new Square();
r.setWidth(5);
r.setHeight(3);
r.area();   // expected 15, actual 9: broken
```$body$,
  $body$```python
# Classic violation: Square inherits from Rectangle
class Square(Rectangle):
    def set_width(self, w: int) -> None:
        self.width = self.height = w

    def set_height(self, h: int) -> None:
        self.width = self.height = h

r: Rectangle = Square()
r.set_width(5)
r.set_height(3)
r.area()     # expected 15, actual 9: broken
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Violation: a fat interface forces empty stubs
interface Printer { void print(); void scan(); void fax(); }
```$body$,
  $body$```python
# Violation: a fat protocol forces empty stubs on everything that adopts it
class Printer(Protocol):
    def print(self) -> None: ...
    def scan(self) -> None: ...
    def fax(self) -> None: ...
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Fix: split it
interface Printable { void print(); }
interface Scannable { void scan(); }
interface Faxable   { void fax(); }

class SimplePrinter implements Printable { /* ... */ }
class OfficePrinter
        implements Printable, Scannable, Faxable { /* ... */ }
```$body$,
  $body$```python
# Fix: split it, and take only what you can do
class Printable(Protocol):
    def print(self) -> None: ...

class Scannable(Protocol):
    def scan(self) -> None: ...

class Faxable(Protocol):
    def fax(self) -> None: ...

class SimplePrinter:                 # satisfies Printable
    def print(self) -> None: ...

class OfficePrinter:                 # satisfies all three
    def print(self) -> None: ...
    def scan(self) -> None: ...
    def fax(self) -> None: ...
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Violation: a hardcoded concrete dependency
class OrderService {
    private MySQLDatabase db = new MySQLDatabase(); // can't swap or mock
}
```$body$,
  $body$```python
# Violation: a hard-coded concrete dependency
class OrderService:
    def __init__(self) -> None:
        self._db = MySQLDatabase()   # cannot be swapped or faked in a test
```$body$)
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
// Fix: depend on an interface, receive the implementation
interface Database { void save(Order o); }

class OrderService {
    private final Database db;
    OrderService(Database db) { this.db = db; } // injected from outside
    void placeOrder(Order o)  { db.save(o); }
}
// prod: new OrderService(new MySQLDatabase());
// test: new OrderService(new MockDatabase());
```$body$,
  $body$```python
# Fix: depend on the shape, receive the implementation
class Database(Protocol):
    def save(self, order: Order) -> None: ...

class OrderService:
    def __init__(self, db: Database) -> None:
        self._db = db                # injected from outside

    def place_order(self, order: Order) -> None:
        self._db.save(order)

OrderService(MySQLDatabase())        # production
OrderService(FakeDatabase())         # test
```$body$)
WHERE title = 'SOLID Principles';


-- ── Composition over Inheritance ───────────────────────────────────────────

UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$```java
class Dog {
    private MovementBehaviour movement;
    private TrickBehaviour tricks;
    Dog(MovementBehaviour m, TrickBehaviour t) {
        this.movement = m; this.tricks = t;
    }
    void move()    { movement.move(); }
    void perform() { tricks.perform(); }
}$body$,
  $body$```python
class Dog:
    def __init__(self, movement: MovementBehaviour, tricks: TrickBehaviour) -> None:
        self._movement, self._tricks = movement, tricks

    def move(self) -> None:
        self._movement.move()

    def perform(self) -> None:
        self._tricks.perform()$body$)
WHERE title = 'Composition over Inheritance';

-- ── The tail of the composition example ─────────────────────────────────────
-- The replacement above stopped at the closing brace of the class and left the
-- Java that used it underneath, so the block was half Python and half Java. It
-- did not error anywhere, because a fenced block is text: nothing compiles it.
-- Found by extracting every ```python block in the seeds and compiling it,
-- which is worth doing after any conversion like this.
UPDATE questions.bank SET lesson_md = replace(lesson_md,
  $body$Dog guide   = new Dog(new GuideWalk(), new AdvancedCommands());
Dog swimmer = new Dog(new Swim(), new BasicTricks());
// a swimming guide dog is a constructor call, not a new class:
// new Dog(new Swim(), new GuideCommands())$body$,
  $body$guide = Dog(GuideWalk(), AdvancedCommands())
swimmer = Dog(Swim(), BasicTricks())

# A swimming guide dog is a constructor call, not a new class:
swimming_guide = Dog(Swim(), GuideCommands())$body$)
WHERE title = 'Composition over Inheritance';
