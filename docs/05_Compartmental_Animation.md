# View 5: Compartmental Model Animation View

## 1. Purpose
To provide a visual, animated representation of the mathematical Pharmacokinetic model (usually a 2 or 3-compartment model), showing how the drug distributes between blood, tissue, and the brain over time.

## 2. UI Elements
*   **Top Toolbar:** Buttons for "Data", "Sizes", "Labels", and a Close "X" button.
*   **Animation Canvas (Top Half):**
    *   **V1 (Central):** Cylinder representing blood plasma.
    *   **V2 & V3 (Peripheral):** Cylinders representing fat/muscle tissues.
    *   **Effect Site:** Small compartment representing the site of action (brain).
    *   **Syringe/IV:** Graphic showing fluid entering V1.
    *   **Clearance:** Graphic showing drug leaving the system.
    *   **Connecting Pipes:** Visual links showing flow rates (k12, k21, etc.).
    *   **Particles:** Animated dots representing drug molecules.
*   **Split-Screen Chart (Bottom Half):** A minimized version of the Main Simulation Graph with a scrubbable vertical timeline cursor.

## 3. Functionalities & User Flow
1.  **Dynamic Sizing:** Tapping "Sizes" likely scales the visual cylinders based on the calculated volumes (V1, V2, V3) derived from the patient's biometrics.
2.  **Fluid Animation:** The "fluid level" inside each cylinder rises and falls dynamically based on the concentration data for that specific compartment.
3.  **Particle Flow:** Particles animate flowing from the syringe into V1, and then back and forth between V1, V2, V3, and the Effect Site.
4.  **Timeline Synchronization (Crucial):** As the user drags the timeline cursor left or right on the bottom chart, the animation in the top half updates instantly to reflect the exact fluid levels and particle distribution at that specific second in time.

## 4. Technical Considerations
*   **Canvas/Graphics API:** This requires a high-performance 2D rendering engine (like React Native Skia, HTML5 Canvas, or native iOS CoreGraphics/Android Canvas). Standard UI views (divs/Views) will not perform well for particle animations.
*   **State Syncing:** The animation frame state must be tightly coupled to the X-axis value (time) of the bottom chart.
