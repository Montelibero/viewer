from playwright.sync_api import sync_playwright, Page, expect

def run(page: Page):
    # Mock Horizon response
    def handle_offers(route):
        route.fulfill(json={
            "_embedded": {
                "records": [
                    {
                        "id": 1001,
                        "paging_token": "1001",
                        "seller": "GATEST",
                        "selling": { "asset_type": "credit_alphanum12", "asset_code": "EURMTL", "asset_issuer": "GABC" },
                        "buying": { "asset_type": "native" },
                        "amount": "1000.0000000",
                        "price": "0.05",
                        "last_modified_time": "2025-02-20T07:35:29Z",
                        "last_modified_ledger": 12345
                    },
                    {
                        "id": 1002,
                        "paging_token": "1002",
                        "seller": "GATEST",
                        "selling": { "asset_type": "native" },
                        "buying": { "asset_type": "credit_alphanum4", "asset_code": "USD", "asset_issuer": "GUSD" },
                        "amount": "500.0000000",
                        "price": "2.0",
                        "last_modified_time": "2024-01-01T10:00:00Z",
                        "last_modified_ledger": 12300
                    }
                ]
            }
        })

    # Intercept any requests to Horizon for offers
    # We match using a wildcard pattern. Since the app uses window.HORIZON_URL or similar,
    # we can just match "*accounts/*/offers*"
    page.route("**/*/accounts/*/offers*", handle_offers)

    # We need to serve the local site. Since we don't have Caddy, we rely on the python server running on 8000.
    # However, Python server returns 404 for deep links.
    # Strategy: Load index.html, then inject a history pushState and trigger router manually.
    page.goto("http://localhost:8000/index.html")

    # Wait for app to be ready
    page.wait_for_selector("#app")

    # Navigate to the account offers page
    page.evaluate("history.pushState(null, '', '/account/GCWJOBIPJQRZLFGQ5RQKE4J3H2QXHAOHCFVDM3FH37APAM3QXQR7POOL/offers');")
    page.evaluate("window.dispatchEvent(new Event('popstate'));") # Trigger router

    # Wait for table to load
    page.wait_for_selector("table#offers-table")

    # Wait for rows
    page.wait_for_selector("tbody#offers-tbody tr")

    # Take initial screenshot
    page.screenshot(path="verification/1_initial_load.png")

    # Test Sorting
    # Click on "Selling" header (should sort ASC first, then DESC or vice versa depending on default)
    # The code sets default new sort to ASC.
    page.click("th[data-sort='selling']")
    page.wait_for_timeout(500) # Wait for re-render
    page.screenshot(path="verification/2_sorted_selling.png")

    # Click again to reverse
    page.click("th[data-sort='selling']")
    page.wait_for_timeout(500)
    page.screenshot(path="verification/3_sorted_selling_desc.png")

    print("Screenshots taken.")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        run(page)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()
