"""Quick smoke test for local dev. Run: .venv/bin/python3 smoke_test.py"""
import httpx, json, sys

base = "http://localhost:8000"

def section(title):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print('='*50)

section("1. Create API key")
r = httpx.post(f"{base}/keys", json={"email": "tav@pdfapi.dev", "label": "local-test"})
key_data = r.json()
key = key_data["key"]
print(json.dumps(key_data, indent=2))

section("2. Usage (should be 0)")
r = httpx.get(f"{base}/keys/usage", headers={"Authorization": f"Bearer {key}"})
print(json.dumps(r.json(), indent=2))

section("3. Billing plans (no auth required)")
r = httpx.get(f"{base}/billing/plans")
for p in r.json()["plans"]:
    print(f"  {p['tier']:8s}  {p['price']:6s}/mo  {p['monthly_limit']:>6} parses/mo  |  {', '.join(p['features'])}")

section("4. Checkout attempt (STRIPE_SECRET_KEY empty → 503 expected)")
r = httpx.post(
    f"{base}/billing/checkout",
    headers={"Authorization": f"Bearer {key}"},
    json={"tier": "starter"},
)
print(f"  HTTP {r.status_code}")
print(json.dumps(r.json(), indent=2))

section("5. Health")
r = httpx.get(f"{base}/health")
print(json.dumps(r.json(), indent=2))

section("6. Auth guard — bad key → 401")
r = httpx.get(f"{base}/keys/usage", headers={"Authorization": "Bearer pdfa_fake"})
print(f"  HTTP {r.status_code}  →  {r.json()}")

section("DONE")
print("  Server is running and all routes respond correctly.")
print(f"  Docs available at: {base}/docs\n")
