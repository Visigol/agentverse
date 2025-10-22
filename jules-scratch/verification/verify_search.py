from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Correct the file path to be absolute
        file_path = os.path.abspath('jules-scratch/verification/search_verification.html')
        page.goto('file://' + file_path)
        page.screenshot(path='jules-scratch/verification/search_results.png')
        browser.close()

run()
