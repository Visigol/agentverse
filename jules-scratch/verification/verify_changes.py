import asyncio
from playwright.sync_api import sync_playwright
import os

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Get the full path to the HTML file
        file_path = "file://" + os.path.abspath("cases.html.txt")
        page.goto(file_path)

        # --- Screenshot 1: Verify Modal Buttons and Truncated Links ---

        # Wait for the elements to be available in the DOM (not necessarily visible)
        page.wait_for_selector('#modal-details-grid', state='attached')
        page.wait_for_selector('#case-action-buttons', state='attached')
        page.wait_for_selector('#case-modal', state='attached')


        # Inject mock data and styles to show the modal with our desired content
        page.evaluate("""() => {
            // Mock data for the details grid
            const grid = document.getElementById('modal-details-grid');
            grid.innerHTML = `
                <div class="field"><strong>Menu link</strong><a href="https://example.com/a-very-long-link-that-should-be-truncated" target="_blank" class="truncate-link">https://example.com/a-very-long-link-that-should-be-truncated</a></div>
                <div class="field"><strong>Dish Photos Link</strong><a href="https://example.com/another-very-long-link-that-should-be-truncated" target="_blank" class="truncate-link">https://example.com/another-very-long-link-that-should-be-truncated</a></div>
            `;

            // Mock data for the action buttons
            const actions = document.getElementById('case-action-buttons');
            actions.innerHTML = `
                <button class="btn-claim"><i class="fa-solid fa-hand"></i> Claim Case</button>
                <button class="btn-pause"><i class="fa-solid fa-pause"></i> Pause Case</button>
                <button class="btn-escalate"><i class="fa-solid fa-triangle-exclamation"></i> Escalate</button>
                <button class="btn-end"><i class="fa-solid fa-flag-checkered"></i> End Case</button>
            `;

            // Force the modal to be visible
            const modal = document.getElementById('case-modal');
            modal.style.display = 'flex';
        }""")

        page.screenshot(path="jules-scratch/verification/verification_modal.png")

        # --- Screenshot 2: Verify Calculation Sidebar ---
        page.wait_for_selector('#edit-guide-sidebar', state='attached')
        # Inject mock data and make the sidebar visible
        page.evaluate("""() => {
            const guideDetails = document.getElementById('guide-calculation-details');
            guideDetails.innerHTML = `
                <p>Changing these times will affect the following stored durations:</p>
                <strong>New Agent Handling Time:</strong><br>
                <span style="font-size: 1.5em; color: var(--primary-accent);">01:30:00</span><br>
                <strong>New Pause Duration:</strong><br>
                <span style="font-size: 1.2em;">00:15:00</span><br>
                <strong>New Escalation Duration:</strong><br>
                <span style="font-size: 1.2em;">00:15:00</span><br><br>
                <hr>
                <strong>Calculation:</strong><br>
                (02:00:00) [Main Task]<br>
                - 00:15:00 [Total Pause]<br>
                - 00:15:00 [Total Escalation]
            `;
            const sidebar = document.getElementById('edit-guide-sidebar');
            sidebar.classList.add('visible');
        }""")

        page.screenshot(path="jules-scratch/verification/verification_sidebar.png")

        browser.close()

run_verification()
