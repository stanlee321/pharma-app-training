# View 4: Main Simulation & Graphing View

## 1. Purpose
The core interface of the app. It allows users to set target drug concentrations, simulate infusions over time, and view real-time, multi-line graphs of drug concentration in the body.

## 2. UI Elements
*   **Top Toolbar:** Settings Icon, Drug Name, Play/Pause/Speed controls, Info Icon.
*   **Status Dashboard:** Displays Model Name, Current Concentration, and toggle icons (Bolus, Infusion, PK, PD).
*   **Dynamic Readouts (Appears during interaction):** Top bars showing calculated "Bolus" (ml, mcg/kg) and "Infusion" (ml/hr, mcg/kg/hr) required to hit a target.
*   **Interactive Chart Area:**
    *   Left Y-Axis: Concentration (ng/ml).
    *   Right Y-Axis: Infusion Rate (ML/hr).
    *   Bottom X-Axis: Time (min).
    *   **Time Cursor:** A vertical line indicating current simulation time.
    *   **Target Node:** A draggable circle on the vertical cursor.
    *   **Graph Curves:** Multiple colored lines representing different data points (Plasma, Effect-site, etc.).
    *   **Data Tooltip:** A floating box attached to the cursor showing exact numerical values for all curves at that specific time.
*   **Bottom Toolbar:** "+ Graph", "Time(min)", Info ("i"). Changes to "Cancel", "Done", and nudge arrows when dragging the target node.

## 3. Functionalities & User Flow
1.  **Setting a Target:** User taps the graph to summon the Target Node. They drag it up/down the Y-axis.
2.  **Real-time Calculation:** As the node is dragged, the math engine instantly calculates the required Bolus and Infusion rates to achieve that concentration, updating the Top Readouts.
3.  **Simulation Execution:** Tapping "Done" applies the target. The graph begins drawing the predicted curves over the X-axis (time).
4.  **Time Controls:** User can play, pause, or speed up the simulation time.
5.  **Scrubbing:** User can drag the vertical Time Cursor left/right to view historical or predicted future data in the tooltip.

## 4. Technical Considerations
*   **Performance:** The charting library must handle rapid re-rendering of complex SVG/Canvas paths without dropping frames while the user drags the target node.
*   **Math Engine Integration:** The UI is entirely dependent on a background utility calculating differential equations based on the `patientProfile` and `modelsDatabase`.
