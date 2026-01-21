from playwright.sync_api import sync_playwright, expect

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Go to the test page served by python http server
        page.goto("http://localhost:8080/site/test_index.html")

        # Verify the footer version text
        footer_version = page.locator("#app-version")
        expect(footer_version).to_contain_text("1.21")

        # Take screenshot
        page.screenshot(path="verification/footer_version.png")

        browser.close()
        print("Verification script finished successfully.")

if __name__ == "__main__":
    run_test()
