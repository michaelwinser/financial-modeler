# **Product Requirements Document (PRD): Event-Driven Personal Finance Modeler**

## **1\. Vision & Objective**

The goal of this project is to build a highly interactive, client-side personal finance projection application. The system will allow users to model complex financial timelines using a deterministic, event-driven architecture rather than complex Monte Carlo simulations.  
It differentiates itself by cleanly separating Macro-Economic conditions (The Environment) from Personal Financial decisions (The Actor), allowing users to overlay hypothetical life events against various global economic scenarios.

## **2\. Core Principles**

* **Local-First & Privacy Preserving:** All data lives in the browser (LocalStorage/IndexedDB). No backend database or server-side computation is required for the core engine.  
* **Config-as-Code Foundation:** A user's financial plan is fundamentally a JSON object representing an initial state and an array of chronological events.  
* **Bounded Determinism over Probability:** Instead of generating "success probabilities" via Monte Carlo, the engine projects a Baseline scenario bounded by Best-Case and Worst-Case volatility margins to create a deterministic "cone of uncertainty."  
* **Instant UI Feedback:** The projection engine must be computationally light enough to re-render the entire 40-year timeline instantaneously as the user drags sliders or moves events.

## **3\. Key Concepts & Definitions**

* **The Environment (Macro Overlay):** A reusable configuration of global economic variables (e.g., CPI Inflation, Base Equity Returns, Cash Yields) that defines its own rate of change over time (e.g., inflation starting at 3% and accelerating by 0.5% annually up to a cap).  
* **The Actor (Micro State):** The user's financial profile, consisting of asset buckets (Taxable, Tax-Advantaged, Illiquid), cost basis tracking, and age.  
* **Primitives (Actions):** The atomic operations the engine can perform (set\_variable, transfer\_funds, liquidate\_asset, purchase\_asset, recurring\_cashflow).  
* **Macros (Events):** Human-readable life events placed on the timeline that bundle multiple primitives (e.g., "Relocate State" \= liquidate\_asset \+ purchase\_asset \+ set\_variable: effective\_tax\_rate).

## **4\. Functional Requirements**

### **4.1 Scenario Configuration**

* Users can define and save multiple "Environments."  
* Users can adjust global variables via sliders (Inflation, Base Return, Volatility Spread).

### **4.2 Timeline Management**

* Users can place Events onto a chronological timeline tied to their age/year.  
* Events must be movable (adjusting the trigger year).  
* Support for complex custom events, such as Net Unrealized Appreciation (NUA) execution (liquidating an asset, isolating the cost basis for ordinary income tax, and transferring the remainder to a capital gains tax bucket).

### **4.3 Calculation Engine**

* **Granularity:** Annual calculation loops.  
* **Real vs. Nominal:** The engine must execute all compounding and taxation math in **Nominal Dollars** (accounting for compounding inflation). The UI must have a global toggle to divide the resulting arrays by the cumulative inflation index to display outputs in **Today's Purchasing Power (Real Dollars)**.  
* **Tax Engine:** Initially utilize blended effective tax rates (Federal \+ State) managed as timeline variables, allowing state relocation events to simply modify the effective\_state\_tax variable.

### **4.4 User Interface**

* A primary visualization chart (Line chart) showing Age on the X-axis and Net Worth / Cash Flow on the Y-axis.  
* Display a solid Baseline with a shaded bounding box for Best/Worst cases.  
* Visual indicators on the chart X-axis representing discrete timeline events.

## **5\. Out of Scope for V1**

* Server-side persistence or user authentication.  
* Exact IRS progressive tax bracket calculations (use blended effective rates).  
* Monthly or daily compounding granularity.  
* Monte Carlo simulations.