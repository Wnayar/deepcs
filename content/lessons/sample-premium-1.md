This is **sample content** standing in for a paid lesson. In a deployed build this file sits under `/content/paid/` and is served only by the Worker, after a Firebase token check and an entitlement row read.

## A sample locked lesson

If you can read this in a browser, either you are running locally (where the gate is not enforced by `vite dev`) or the entitlement check passed. The public test suite asserts all three answers of the gate: 401 anonymous, 402 signed-in-but-unpaid, 200 entitled.
