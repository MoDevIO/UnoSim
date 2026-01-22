#!/usr/bin/env python3
"""
Font Size Measurement Script for Arduino Simulator
Measures and documents font sizes across all UI components
"""
import argparse
import csv
import json
import time
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

FONT_SCALES = [
    ("S", 0.875, 12),
    ("M", 1.0, 14),
    ("L", 1.125, 16),
    ("XL", 1.25, 18),
    ("XXL", 1.5, 20),
]

def load_selectors(config_path):
    """Load component selectors from JSON config file"""
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: Config file '{config_path}' not found!")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON config: {e}")
        sys.exit(1)

def set_font_scale(driver, scale_value):
    """Set font scale via settings dialog"""
    try:
        # Try to find settings button via common patterns
        print(f"  Setting font scale to {scale_value}...")
        
        # Method 1: Direct localStorage manipulation (more reliable)
        driver.execute_script(f"""
            localStorage.setItem('unoFontScale', '{scale_value}');
            document.documentElement.style.setProperty('--ui-font-scale', '{scale_value}');
            document.dispatchEvent(new CustomEvent('uiFontScaleChange', {{detail: {{value: {scale_value}}}}}));
        """)
        time.sleep(0.5)
        return True
        
    except Exception as e:
        print(f"  Warning: Could not set font scale: {e}")
        return False

def measure_font_size(driver, selector, component_name):
    """Measure computed font size for a given selector"""
    try:
        # Wait for element to be present
        WebDriverWait(driver, 3).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, selector))
        )
        
        el = driver.find_element(By.CSS_SELECTOR, selector)
        
        # Get computed font-size
        size = driver.execute_script("""
            return window.getComputedStyle(arguments[0]).fontSize;
        """, el)
        
        # Also get the CSS rule source if possible
        css_source = driver.execute_script("""
            const el = arguments[0];
            const computed = window.getComputedStyle(el);
            return computed.fontSize;
        """, el)
        
        return float(size.replace("px", "")), "✓", None
        
    except TimeoutException:
        return None, "Timeout", "Element nicht innerhalb von 3s gefunden"
    except NoSuchElementException:
        return None, "Nicht gefunden", "Selektor matched kein Element"
    except Exception as e:
        return None, "Fehler", str(e)

def init_driver(headless=True):
    """Initialize Chrome WebDriver"""
    chrome_options = Options()
    if headless:
        chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-logging"])
    chrome_options.page_load_strategy = 'eager'
    
    try:
        driver = webdriver.Chrome(options=chrome_options)
        driver.set_page_load_timeout(30)
        return driver
    except Exception as e:
        print(f"Error initializing Chrome driver: {e}")
        print("\nMake sure Chrome and ChromeDriver are installed:")
        print("  brew install --cask google-chrome")
        print("  brew install chromedriver")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(
        description="Font size measurement for Arduino Simulator UI"
    )
    parser.add_argument(
        "--url", 
        default="http://localhost:5173",
        help="URL of the running application"
    )
    parser.add_argument(
        "--config", 
        default="font_selectors.json",
        help="JSON file with selectors"
    )
    parser.add_argument(
        "--output", 
        default="font_report.md",
        help="Output markdown file"
    )
    parser.add_argument(
        "--csv", 
        default="font_report.csv",
        help="Output CSV file"
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="Run browser in visible mode"
    )
    args = parser.parse_args()

    print(f"Loading selectors from {args.config}...")
    selectors = load_selectors(args.config)
    print(f"Found {len(selectors)} components to measure\n")

    print(f"Starting Chrome browser (headless={not args.no_headless})...")
    driver = init_driver(headless=not args.no_headless)
    
    try:
        print(f"Loading application from {args.url}...")
        try:
            driver.get(args.url)
        except Exception as e:
            print(f"Error loading page: {e}")
            print("Retrying...")
            time.sleep(2)
            driver.get(args.url)
        
        # Wait for page to load
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.TAG_NAME, "body"))
        )
        time.sleep(3)  # Extra time for React to hydrate
        print("Application loaded successfully\n")

        results = []
        
        for label, scale, expected_px in FONT_SCALES:
            print(f"Testing scale {label} ({expected_px}px)...")
            set_font_scale(driver, scale)
            time.sleep(0.5)
            
            for comp in selectors:
                name = comp["name"]
                selector = comp["selector"]
                description = comp.get("description", "")
                
                print(f"  Measuring: {name}...")
                measured, status, error = measure_font_size(driver, selector, name)
                
                abweichung = ""
                if measured is not None:
                    abweichung = round(measured - expected_px, 2)
                    # More lenient threshold: 1px tolerance
                    status = "✓" if abs(abweichung) <= 1.0 else "✗"
                    print(f"    → {measured}px (expected {expected_px}px, diff: {abweichung}px) {status}")
                else:
                    measured_str = f"{status}"
                    if error:
                        print(f"    → {status}: {error}")
                    results.append({
                        "Komponente": name,
                        "Beschreibung": description,
                        "CSS-Selektor": selector,
                        "Skalierung": label,
                        "Gemessene Größe (px)": measured_str,
                        "Erwartet (px)": expected_px,
                        "Status": "✗",
                        "Abweichung": error or "N/A"
                    })
                    continue
                
                results.append({
                    "Komponente": name,
                    "Beschreibung": description,
                    "CSS-Selektor": selector,
                    "Skalierung": label,
                    "Gemessene Größe (px)": f"{measured:.1f}",
                    "Erwartet (px)": expected_px,
                    "Status": status,
                    "Abweichung": f"{abweichung:+.1f}" if abweichung != "" else ""
                })
            
            print()

        # Write Markdown report
        print(f"Writing report to {args.output}...")
        with open(args.output, "w", encoding="utf-8") as f:
            f.write("# Font Size Measurement Report\n\n")
            f.write(f"**Datum:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"**URL:** {args.url}\n\n")
            f.write("## Ergebnisse\n\n")
            f.write("| Komponente | Beschreibung | CSS-Selektor | Skalierung | Gemessen (px) | Erwartet (px) | Status | Abweichung |\n")
            f.write("|------------|--------------|--------------|------------|---------------|---------------|--------|------------|\n")
            for row in results:
                f.write(
                    f"| {row['Komponente']} "
                    f"| {row['Beschreibung']} "
                    f"| `{row['CSS-Selektor']}` "
                    f"| {row['Skalierung']} "
                    f"| {row['Gemessene Größe (px)']} "
                    f"| {row['Erwartet (px)']} "
                    f"| {row['Status']} "
                    f"| {row['Abweichung']} |\n"
                )
            
            # Summary
            f.write("\n## Zusammenfassung\n\n")
            total = len(results)
            passed = sum(1 for r in results if r['Status'] == '✓')
            failed = total - passed
            f.write(f"- **Gesamt:** {total} Messungen\n")
            f.write(f"- **Bestanden:** {passed} ({100*passed/total:.1f}%)\n")
            f.write(f"- **Fehlgeschlagen:** {failed} ({100*failed/total:.1f}%)\n")

        # Write CSV
        print(f"Writing CSV to {args.csv}...")
        with open(args.csv, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                "Komponente", "Beschreibung", "CSS-Selektor", "Skalierung",
                "Gemessene Größe (px)", "Erwartet (px)", "Status", "Abweichung"
            ])
            for row in results:
                writer.writerow([
                    row["Komponente"],
                    row["Beschreibung"],
                    row["CSS-Selektor"],
                    row["Skalierung"],
                    row["Gemessene Größe (px)"],
                    row["Erwartet (px)"],
                    row["Status"],
                    row["Abweichung"]
                ])

        print(f"\n✅ Fertig! Ergebnisse in:")
        print(f"   - {args.output}")
        print(f"   - {args.csv}")
        
    finally:
        driver.quit()
        print("\nBrowser geschlossen.")

if __name__ == "__main__":
    main()
