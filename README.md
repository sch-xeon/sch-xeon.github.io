# AP Physics C Practice Simulator

Run locally:

```powershell
python server.py
```

Student app:

```text
http://127.0.0.1:8765/
```

Admin dashboard:

```text
http://127.0.0.1:8765/admin.html
```

Temporary hosting notes:

- This app can run on Replit as a Python project.
- Upload all files and folders in this project.
- Replit should use the `.replit` file and run `python server.py`.
- The server reads Replit's `PORT` environment variable automatically.
- The admin dashboard can upload FRQ images, and student FRQ pages poll for them every 2 seconds.
