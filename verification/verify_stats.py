
import os
import re
from playwright.sync_api import sync_playwright, expect, Route

# We will serve the site directory using python's http.server in the background,
# but for simplicity in this script we can assume the server is running on port 8000.
# I will start the server in a separate bash command.

def verify_stats_page(page):
    # Mock Horizon API response for Operations
    # This ensures we have predictable data to verify the aggregation logic

    def handle_operations(route: Route):
        # Return a mix of operations to test aggregation
        # 1. Payment
        # 2. Manage Sell Offer (Order)
        # 3. Path Payment (Swap)
        # 4. Change Trust (Trustline)
        # 5. Manage Buy Offer (Order)

        # All in 2025

        response = {
            "_embedded": {
                "records": [
                    {
                        "type": "payment",
                        "created_at": "2025-06-01T10:00:00Z",
                        "id": "1"
                    },
                    {
                        "type": "manage_sell_offer",
                        "created_at": "2025-05-01T10:00:00Z",
                        "id": "2"
                    },
                    {
                        "type": "path_payment_strict_send",
                        "created_at": "2025-04-01T10:00:00Z",
                        "id": "3"
                    },
                    {
                        "type": "change_trust",
                        "created_at": "2025-03-01T10:00:00Z",
                        "id": "4"
                    },
                    {
                        "type": "manage_buy_offer",
                        "created_at": "2025-02-01T10:00:00Z",
                        "id": "5"
                    },
                     {
                        "type": "create_passive_sell_offer",
                        "created_at": "2025-02-15T10:00:00Z",
                        "id": "6"
                    }
                ]
            },
            "_links": {
                "next": {
                    "href": "https://horizon.stellar.org/accounts/GABC/operations?cursor=100&limit=200"
                }
            }
        }

        # If cursor is present, return empty to stop fetching
        if "cursor" in route.request.url:
            response = {"_embedded": {"records": []}}

        route.fulfill(json=response)

    # Intercept operations call
    # Matches: .../accounts/GABC/operations...
    page.route("**/accounts/GABC/operations*", handle_operations)

    # Navigate to the page
    # Using local index file served on port 8000
    page.goto("http://localhost:8000/account/GABC/2025")

    # Wait for the stats container to be visible (loading finished)
    # The loader runs for at least a few seconds because of the fetch
    # We can wait for specific text or element
    stats_container = page.locator("#stats-container")
    expect(stats_container).to_be_visible(timeout=10000)

    # Verify counts
    # Total: 6
    # Orders: 3 (Sell, Buy, Passive)
    # Swaps: 1 (Strict Send)
    # Payments: 1
    # Trustlines: 1

    expect(page.locator("#stat-total-ops")).to_have_text("6")
    expect(page.locator("#stat-orders")).to_have_text("3")
    expect(page.locator("#stat-swaps")).to_have_text("1")
    expect(page.locator("#stat-payments")).to_have_text("1")
    expect(page.locator("#stat-trustlines")).to_have_text("1")

    # Verify Translations (English default)
    expect(page.locator("h1[data-i18n='title']")).to_have_text("2025 Statistics")

    # Take screenshot
    page.screenshot(path="verification/account_stats.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_stats_page(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
            raise e
        finally:
            browser.close()
