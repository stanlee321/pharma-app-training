# View 2: Drug & Model Selection Screen

## 1. Purpose
To allow the user to select a specific drug and the corresponding mathematical Pharmacokinetic/Pharmacodynamic (PK/PD) model used to calculate its behavior.

## 2. UI Elements
*   **Top Header:**
    *   Title: "Select Drug 1"
    *   Right Action Button: "SELECT 1" (Proceeds to next screen).
*   **Main Content Area (Read-Only):**
    *   Dynamic text area displaying metadata for the currently selected model.
    *   Fields include: Description, Publication source (with clickable links), Comments, and Implementation details (e.g., target effects, manual dosing rules).
*   **Interactive Picker:**
    *   An iOS-style scrollable wheel picker (or modern equivalent) located at the bottom.
    *   Displays combinations of Drug + Model (e.g., "Propofol [Marsh]", "Dexmedetomidine [Hannivoort]").
*   **Bottom Toolbar:**
    *   Buttons: "Edit Drug List", "Saved Simulations".

## 3. Functionalities & User Flow
1.  **Scrolling Selection:** As the user scrolls the picker wheel, the Main Content Area updates instantly to reflect the metadata of the highlighted item.
2.  **Link Handling:** URLs in the publication section must be clickable and open in a browser.
3.  **Confirmation:** Tapping "SELECT 1" saves the selected drug/model to the global state and navigates to the Patient Data Input screen.

## 4. Data & State Management
*   `modelsDatabase`: A local JSON/database containing all available drugs, their associated models, metadata, and mathematical constants.
*   `selectedModelIndex`: Integer tracking the currently highlighted item in the picker.

## 5. Technical Considerations
*   The picker must be highly performant and responsive, ensuring the text area updates without lag during rapid scrolling.
