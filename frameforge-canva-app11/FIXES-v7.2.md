# Folder visibility fix v7.2

- A created folder is inserted into the sidebar immediately using a functional state update.
- The app then reloads `/api/frames` and verifies that the folder exists in Worker storage.
- Success appears only after server verification; missing/old Worker responses now show a clear error instead of a false success.
- Search is cleared and the newly created folder becomes active so it is visible immediately.
