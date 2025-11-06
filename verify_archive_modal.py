
from playwright.sync_api import Page, expect, sync_playwright
import json

def test_archive_modal_functionality(page: Page):
    """
    This test verifies that the refactored Archive page in manager.html
    correctly opens a detailed, read-only case modal.
    """
    # 1. Arrange: Navigate to the local manager.html file.
    # The file path must be absolute for Playwright to open it.
    page.goto("file:///app/manager.html")

    # Mock google.script.run to prevent errors, as it's not available locally.
    # This mock simulates a successful return of archived case data.
    mock_case_data = {
        "records": [
            {
                "Main Task ID": "ARCH-001",
                "Country": "Testland",
                "Account Name": "Archived Corp",
                "Status": "Completed",
                "Main Task End Date/Time": "2023-10-27T10:00:00Z",
                "pauses": [
                    {"ID": "P-001", "Pause Start Time": "2023-10-27T09:00:00Z", "Pause End Time": "2023-10-27T09:15:00Z"}
                ],
                "escalations": [],
                "cooperations": []
            }
        ],
        "total": 1
    }

    # Correctly serialize the JSON object to a string for the mock
    mock_response_json = json.dumps(mock_case_data)

    page.evaluate(f"""
        window.google = {{
            script: {{
                run: {{
                    withSuccessHandler: function(handler) {{
                        // Immediately invoke the handler with the mock data
                        handler({mock_response_json});
                        return this;
                    }},
                    withFailureHandler: function(handler) {{
                        return this;
                    }},
                    getArchivedCases: function(options) {{
                        // This function is chained, so the handler above will be called.
                        return;
                    }}
                }}
            }}
        }};
    """)

    # 2. Act: Switch to the Archive tab and open the modal.
    page.get_by_role("button", name="Archive").click()

    # The getArchivedCases mock will be called automatically, so we wait for the result.
    # Wait for the table row to be visible before clicking.
    row_to_click = page.locator('tr:has-text("ARCH-001")')
    expect(row_to_click).to_be_visible()
    row_to_click.click()

    # 3. Assert: Verify the modal content is correct and read-only.
    modal_title = page.locator("#modal-title")
    expect(modal_title).to_have_text("Archived Case: ARCH-001")

    # Check for a specific field from the main task.
    country_field = page.locator('.field:has-text("Country") span')
    expect(country_field).to_have_text("Testland")

    # Check that the log section is visible and contains log data.
    expect(page.locator("#pausing-logs-container")).to_be_visible()
    expect(page.locator('.log-record .field:has-text("ID") span')).to_have_text("P-001")

    # Ensure no action buttons are visible, confirming read-only state.
    expect(page.locator("#case-action-buttons button")).not_to_be_visible()
    expect(page.locator("#modal-btn-edit")).not_to_be_visible()

    # 4. Screenshot: Capture the final result.
    page.screenshot(path="verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_archive_modal_functionality(page)
        finally:
            browser.close()
