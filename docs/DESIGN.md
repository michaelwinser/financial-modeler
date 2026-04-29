# **Technical Design Document (DESIGN)**

## **Project: Event-Driven Personal Finance Modeler**

### **1\. Architecture Overview**

This application is a local-first, Single Page Application (SPA). The calculation engine must be written as a suite of pure, deterministic functions to ensure absolute testability and immediate UI reactivity.

* **Framework:** React (via Vite) \+ TypeScript.  
* **State Management:** Zustand (preferred for minimal boilerplate and easy JSON serialization) or Redux Toolkit.  
* **Visualization:** Recharts, Chart.js, or lightweight D3 wrappers.  
* **Persistence:** Browser localStorage (serializing the Zustand store).

### **2\. AI Coding Agent Directives (CRITICAL)**

* **Strict Typing:** Enforce strict TypeScript interfaces for all Primitives, Macros, and State objects. Do not use any.  
* **Pure Functions:** The core Engine.ts must be side-effect free. It receives (InitialState, Environment, Events\[\]) and returns Array\<YearlyProjection\>.  
* **Config-as-Code:** Treat the financial model as an executable configuration file. The UI should merely be a visual editor for the underlying JSON structure.  
* **No Hallucinated Math:** Stick strictly to the defined calculation loop. Do not introduce complex stochastic math libraries.

### **3\. Data Schema Definitions**

#### **3.1 The Environment**

interface EnvVariable {  
  start\_rate: number;  
  annual\_acceleration: number;  
  cap?: number;  
  floor?: number;  
}

interface Environment {  
  id: string;  
  name: string;  
  cpi\_inflation: EnvVariable;  
  equity\_return: EnvVariable;  
  volatility\_range: number; // e.g., 0.03 for \+/- 3%  
}

#### **3.2 Timeline Events & Primitives**

type ActionType \= 'set\_variable' | 'transfer\_funds' | 'liquidate\_asset' | 'purchase\_asset';

interface PrimitiveAction {  
  type: ActionType;  
  target: string;  
  value?: number;  
  new\_rate?: number;  
}

interface TimelineEvent {  
  id: string;  
  name: string;  
  trigger\_age: number;  
  actions: PrimitiveAction\[\];  
}

#### **3.3 The Actor State**

interface ActorState {  
  current\_age: number;  
  effective\_tax\_rate: number;  
  accounts: Record\<string, Account\>;  
}

interface Account {  
  id: string;  
  balance: number;  
  tax\_treatment: 'ordinary' | 'capital\_gains' | 'tax\_free';  
  cost\_basis?: number; // Crucial for NUA modeling  
}

### **4\. The Calculation Loop (Engine.ts)**

The simulation executes sequentially for N years (e.g., Age 62 to 95).  
**For Year T:**

1. **Resolve Environment:** Calculate current year's macro rates:  
   * current\_inflation \= prev\_inflation \+ cpi.annual\_acceleration  
   * cumulative\_inflation\_index \*= (1 \+ current\_inflation)  
2. **Process Events:** Filter TimelineEvent\[\] for events where trigger\_age \=== current\_age.  
   * Execute the PrimitiveAction\[\] sequentially to mutate the ActorState for this specific year (e.g., deducting taxes, moving balances).  
3. **Apply Growth & Tax Drag:**  
   * Grow remaining balances by the Environment's equity return minus the applicable tax drag.  
   * Calculate Baseline, Best-Case (return \+ volatility), and Worst-Case (return \- volatility).  
4. **Record Frame:** Push a frozen copy of the calculated state (and the cumulative\_inflation\_index) to the results array.

### **5\. UI Transformation Layer**

The chart components must not execute financial logic. They simply map over the results array.

* If the user toggles "Nominal Dollars", map the raw balance.  
* If the user toggles "Today's Dollars", map balance / cumulative\_inflation\_index.

### **6\. Edge Case Implementation: NUA Event**

The NUA (Net Unrealized Appreciation) requires a custom macro definition.  
When triggered, the actions array executes:

1. liquidate\_asset: Empties the specific 401(k) bucket.  
2. tax\_deduction: Applies current effective\_tax\_rate strictly to the cost\_basis value of the asset.  
3. purchase\_asset: Creates a new taxable brokerage account with the remaining balance, setting tax\_treatment to capital\_gains for future withdrawals.