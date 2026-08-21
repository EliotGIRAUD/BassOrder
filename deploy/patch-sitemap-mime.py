#!/usr/bin/env python3
"""Force a single application/xml Content-Type for /sitemap.xml."""
from pathlib import Path
import re

p = Path("/etc/nginx/sites-enabled/bassorder.smegg.cloud.conf")
t = p.read_text()

block = (
    "    location = /sitemap.xml {\n"
    "        types { application/xml xml; }\n"
    "        default_type application/xml;\n"
    "        try_files $uri =404;\n"
    "    }\n"
)

pat = re.compile(r"    location = /sitemap\.xml \{.*?\n    \}\n", re.S)
if not pat.search(t):
    raise SystemExit("sitemap location not found")
p.write_text(pat.sub(block, t, count=1))
print("updated")
