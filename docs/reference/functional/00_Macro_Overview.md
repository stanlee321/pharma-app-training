# App Overview: TIVA/TCI Simulation App (Rebuild)

## 1. Product Summary
This application is a highly specialized medical simulation tool designed for anesthesiologists and medical professionals. It calculates and visualizes Pharmacokinetics (PK) and Pharmacodynamics (PD) for Total Intravenous Anesthesia (TIVA) and Target Controlled Infusion (TCI). 

The app allows users to input patient biometrics, select specific mathematical drug models, set target drug concentrations, and visualize how the drug distributes through the human body over time using both graphs and compartmental animations.

## 2. Core Technical Challenges for the Tech Team
*   **Mathematical Engine:** The app relies on complex differential equations (e.g., Marsh, Schnider, Hannivoort models). A robust, highly performant local state manager or math utility is required to calculate time-series data instantly based on user inputs.
*   **Advanced Interactive Charting:** Requires a charting library capable of dual Y-axes, real-time line drawing, draggable nodes (for setting targets), and custom tooltips that track a vertical scrubbing cursor.
*   **Canvas/Animation Engine:** Requires a 2D drawing library (e.g., Canvas API, Skia, or similar) to animate fluid levels and particle flow between compartmental models, synchronized perfectly with a scrubbable timeline.

## 3. Screen Inventory
1.  **Initial Launch & Modal View:** Entry point and announcements.
2.  **Drug & Model Selection Screen:** Selection of drug and PK/PD model.
3.  **Patient Data Input Screen:** Biometric data collection.
4.  **Main Simulation & Graphing View:** Core interactive chart and dosing calculator.
5.  **Compartmental Model Animation View:** Visual representation of drug distribution synchronized with the timeline.

