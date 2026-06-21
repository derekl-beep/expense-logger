#!/usr/bin/env python
"""One-time script to seed family user accounts. Run once after deploying."""
import bcrypt
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from agent.db import create_user

USERNAMES = ["derek", "kelly"]

print("Seeding family accounts. Passwords are hashed before storage.\n")

for username in USERNAMES:
    password = getpass.getpass(f"Password for '{username}': ")
    if not password:
        print(f"  Skipping {username} (empty password)\n")
        continue
    try:
        create_user(username, bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode())
        print(f"  Created: {username}\n")
    except Exception as e:
        print(f"  Skipped {username}: {e}\n")

print("Done. Users can now log in at /auth/login.")
