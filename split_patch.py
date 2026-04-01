import re
import os

with open("pr9.patch", "r") as f:
    content = f.read()

# Split by diff --git
diffs = re.split(r'^diff --git ', content, flags=re.MULTILINE)[1:]

os.makedirs("pr_diffs", exist_ok=True)

for diff in diffs:
    lines = diff.split('\n')
    header = lines[0]
    file_a, file_b = header.split(' ')
    file_name = file_b.replace('b/', '', 1)
    
    # Save diff
    safe_name = file_name.replace('/', '_')
    with open(f"pr_diffs/{safe_name}.diff", "w") as f:
        f.write("diff --git " + diff)
